const VALID_STATES = new Set(
  (
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA " +
    "ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR " +
    "PA RI SC SD TN TX UT VT VA WA WV WI WY"
  ).split(" ")
);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

export default async function handler(request) {
  if (request.method !== "POST") {
    return json(405, {
      success: false,
      message: "Use POST."
    });
  }

  const apiKey = process.env.CARAPI_KEY;

  if (!apiKey) {
    return json(503, {
      success: false,
      message: "Plate lookup is not configured. Please use VIN or manual entry."
    });
  }

  let input;

  try {
    const text = await request.text();

    if (text.length > 2048) {
      return json(413, {
        success: false,
        message: "Request is too large."
      });
    }

    input = JSON.parse(text);
  } catch {
    return json(400, {
      success: false,
      message: "Invalid request."
    });
  }

  if (
    typeof input?.plate !== "string" ||
    typeof input?.state !== "string"
  ) {
    return json(400, {
      success: false,
      message: "Enter a license plate and registration state."
    });
  }

  const plate = input.plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const state = input.state.trim().toUpperCase();

  if (
    !/^[A-Z0-9]{1,12}$/.test(plate) ||
    !VALID_STATES.has(state)
  ) {
    return json(400, {
      success: false,
      message: "Please check the plate number and registration state."
    });
  }

  const url = new URL(
    `https://api.carapi.dev/v1/plate-to-vin/${encodeURIComponent(plate)}`
  );
  url.searchParams.set("token", apiKey);
  url.searchParams.set("country", "US");
  url.searchParams.set("state", state);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      console.error("CarAPI returned HTTP", response.status);

      return json(response.status === 429 ? 429 : 502, {
        success: false,
        message: response.status === 429
          ? "Plate lookup is busy or has reached its usage limit. Please use VIN or manual entry."
          : "The plate service could not find a match or is unavailable. Please use VIN or manual entry."
      });
    }

    const data = await response.json();
    const vin = typeof data?.vin === "string" ? data.vin.trim().toUpperCase() : "";

    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
      return json(422, {
        success: false,
        message: "No single VIN could be confirmed. Please use VIN or manual entry."
      });
    }

    return json(200, {
      success: true,
      vin
    });

  } catch (err) {
    return json(502, {
      success: false,
      message: err?.name === "AbortError"
        ? "Plate lookup timed out. Please try again or use VIN/manual entry."
        : "The plate lookup could not be completed. Please use VIN or manual entry."
    });

  } finally {
    clearTimeout(timeout);
  }
}
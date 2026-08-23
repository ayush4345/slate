import assert from "node:assert/strict";
import { test } from "node:test";

import type { HttpClient } from "./http.js";
import { WeatherService, wmoText } from "./weather.js";

class CannedHttp implements HttpClient {
  async getJson(url: string): Promise<any> {
    if (url.includes("geocoding-api")) {
      return { results: [{ latitude: 35.68, longitude: 139.69, name: "Tokyo" }] };
    }
    return { current: { temperature_2m: 22.5, wind_speed_10m: 8, weather_code: 1 } };
  }
}

test("WeatherService geocodes and returns current conditions", async () => {
  const svc = new WeatherService(new CannedHttp());
  assert.equal(svc.price({ location: "Tokyo" }), 1n);
  const result = await svc.handle({ location: "Tokyo" });
  assert.equal(result.location, "Tokyo");
  assert.equal(result.temperatureC, 22.5);
  assert.equal(result.summary, wmoText(1));
});

test("WeatherService rejects unknown places", async () => {
  const http: HttpClient = { getJson: async () => ({ results: [] }) };
  await assert.rejects(
    () => new WeatherService(http).handle({ location: "Narnia" }),
    /location not found/,
  );
});

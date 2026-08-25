const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

const SCHEMA_ROOT = path.join(__dirname, "..", "static", "schemas", "source");

function readSchema(uri) {
  assert.match(uri, /^\/schemas\//);
  return JSON.parse(
    fs.readFileSync(path.join(SCHEMA_ROOT, uri.slice("/schemas/".length)), "utf8")
  );
}

async function compile(schema) {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    loadSchema: async (ref) => readSchema(ref),
  });
  addFormats(ajv);
  return ajv.compileAsync(schema);
}

// Extracts the {low, mid, high} maximum bounds from the compact
// allOf: [{$ref: forecast-range}, {properties: {...maximum...}}] pattern.
function rangeBounds(propertySchema, label) {
  assert.ok(propertySchema, `${label} missing`);
  assert.ok(Array.isArray(propertySchema.allOf), `${label} lacks the bounded allOf pattern`);
  const constraint = propertySchema.allOf.find((entry) => entry.properties);
  assert.ok(constraint, `${label} allOf carries no constraint branch`);
  return ["low", "mid", "high"].map((k) => constraint.properties[k]?.maximum);
}

describe("canonical-forecast-point parity with forecast-point", () => {
  let source;
  let canonical;

  before(() => {
    source = readSchema("/schemas/core/forecast-point.json");
    canonical = readSchema("/schemas/core/canonical-forecast-point.json");
  });

  it("keeps the viewability property sets aligned (vendor ref differs by design)", () => {
    const sourceKeys = Object.keys(source.properties.viewability.properties).sort();
    const canonicalKeys = Object.keys(canonical.properties.viewability.properties).sort();
    assert.deepEqual(canonicalKeys, sourceKeys);
    // The canonical lifecycle swaps brand-ref for the identity-only brand-key;
    // any other ref divergence is drift.
    assert.equal(source.properties.viewability.properties.vendor.$ref, "/schemas/core/brand-ref.json");
    assert.equal(canonical.properties.viewability.properties.vendor.$ref, "/schemas/core/brand-key.json");
  });

  it("carries the standard-required anyOf on both twins", () => {
    assert.ok(source.properties.viewability.anyOf, "source anyOf missing");
    assert.deepEqual(
      canonical.properties.viewability.anyOf,
      source.properties.viewability.anyOf,
      "canonical viewability anyOf drifted from source"
    );
  });

  it("keeps the rate bounds on both twins", () => {
    assert.deepEqual(
      rangeBounds(canonical.properties.viewability.properties.viewable_rate, "canonical viewable_rate"),
      rangeBounds(source.properties.viewability.properties.viewable_rate, "source viewable_rate")
    );
    assert.deepEqual(
      rangeBounds(canonical.properties.metrics.properties.coverage_rate, "canonical coverage_rate"),
      rangeBounds(source.properties.metrics.properties.coverage_rate, "source coverage_rate")
    );
  });

  describe("canonical twin enforces the restored constraints", () => {
    let validate;

    before(async () => {
      validate = await compile(readSchema("/schemas/core/canonical-forecast-point.json"));
    });

    it("accepts a bounded viewability row with a standard", () => {
      const row = {
        metrics: { impressions: { low: 1000, mid: 2000, high: 3000 } },
        viewability: {
          viewable_rate: { low: 0.5, mid: 0.6, high: 0.7 },
          measurable_impressions: { low: 900, mid: 1800, high: 2700 },
          standard: "mrc",
        },
      };
      assert.equal(validate(row), true, JSON.stringify(validate.errors));
    });

    it("rejects a viewable_rate above 1", () => {
      const row = {
        metrics: {},
        viewability: {
          viewable_rate: { low: 0.5, mid: 1.2, high: 1.3 },
          standard: "mrc",
        },
      };
      assert.equal(validate(row), false);
    });

    it("rejects viewability values without a standard", () => {
      const row = {
        metrics: {},
        viewability: {
          viewable_rate: { low: 0.5, mid: 0.6, high: 0.7 },
        },
      };
      assert.equal(validate(row), false);
    });

    it("rejects a coverage_rate above 1 while accepting other unbounded metrics", () => {
      assert.equal(
        validate({ metrics: { coverage_rate: { low: 0.2, mid: 1.4, high: 1.5 } } }),
        false
      );
      assert.equal(
        validate({ metrics: { impressions: { low: 100, mid: 200, high: 300 } } }),
        true,
        JSON.stringify(validate.errors)
      );
    });
  });
});

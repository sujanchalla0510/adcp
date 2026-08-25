---
"adcontextprotocol": minor
---

Restore the normative constraints `canonical-forecast-point` dropped from its source twin: the `maximum: 1` bounds on `viewable_rate` and `metrics.coverage_rate` ranges, and the `anyOf` requiring `standard` whenever any viewability value is present. A parity contract test now compares the twins' viewability property sets, the anyOf, and the rate bounds, so canonical-pair drift on this schema fails CI instead of shipping silently.

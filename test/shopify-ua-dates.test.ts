import test from "node:test";
import assert from "node:assert/strict";

import {
        addDays,
        localMidnightUtcIso,
        buildCreatedAtSearch,
} from "../src/shopify-ua.ts";

test("Europe/Kyiv summer midnight converts to UTC+3", () => {
        assert.equal(
                localMidnightUtcIso("2026-09-07", "Europe/Kyiv"),
                "2026-09-06T21:00:00.000Z",
        );
});

test("Europe/Kyiv winter midnight converts to UTC+2", () => {
        assert.equal(
                localMidnightUtcIso("2026-01-15", "Europe/Kyiv"),
                "2026-01-14T22:00:00.000Z",
        );
});

test("addDays crosses month and year boundaries", () => {
        assert.equal(addDays("2026-09-30", 1), "2026-10-01");
        assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("Shopify created_at search uses quoted inclusive-start/exclusive-end UTC instants", () => {
        assert.equal(
                buildCreatedAtSearch(
                        "2026-09-07",
                        "2026-09-13",
                        "Europe/Kyiv",
                ),
                "created_at:>='2026-09-06T21:00:00.000Z' created_at:<'2026-09-13T21:00:00.000Z'",
        );
});

test("single local day uses next local midnight as exclusive upper bound", () => {
        assert.equal(
                buildCreatedAtSearch(
                        "2026-09-07",
                        "2026-09-07",
                        "Europe/Kyiv",
                ),
                "created_at:>='2026-09-06T21:00:00.000Z' created_at:<'2026-09-07T21:00:00.000Z'",
        );
});

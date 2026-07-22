"use strict";

const receiptStore = require("../receiptStore");

test("exports the active campaign lookup used by receiptHandler", () => {
  expect(receiptStore.getActiveCampaign).toEqual(expect.any(Function));
});

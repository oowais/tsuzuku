// A virtual clock for the fixture recorder (scripts/record-fixtures.mjs), loaded with `node --import` before
// the server starts. Time starts at FIXED_NOW and stands still; it moves only when a timer fires, to that
// timer's due time. So the source wrapper's throttle still waits (and the bucket refills), yet every date the
// server computes is the same on every run.
const start = Date.parse(process.env.FIXED_NOW ?? "");
if (Number.isNaN(start)) throw new Error("FIXED_NOW must be an ISO date");

const RealDate = Date;
let elapsed = 0;
const now = () => start + elapsed;

class FixedDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(now());
  }
  static now() {
    return now();
  }
}
// `Date()` called as a function returns a string, like the real one.
globalThis.Date = new Proxy(FixedDate, {
  apply: () => new FixedDate().toString(),
});

const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = function setTimeout(fn, ms, ...rest) {
  const due = elapsed + Math.max(0, Number(ms) || 0);
  return realSetTimeout(
    (...a) => {
      if (due > elapsed) elapsed = due;
      if (typeof fn === "function") fn(...a);
    },
    ms,
    ...rest,
  );
};
// Keeps util.promisify(setTimeout) and friends working.
Object.assign(globalThis.setTimeout, realSetTimeout);

function clean(value, fallback = "") {
  return String(value || fallback)
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\;,]/g, (match) => `\\${match}`)
    .slice(0, 500);
}

function icsDate(value) {
  const ms = Number(value || 0);
  const date = Number.isFinite(ms) && ms > 0 ? new Date(ms) : new Date(Date.now() + 60 * 60 * 1000);
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const startMs = Number(qs.start || 0);
  const endMs = Number(qs.end || startMs + 15 * 60 * 1000);
  const title = clean(qs.title, "Your Garden Is Calling");
  const details = clean(qs.details, "Check your Seeds, use tools if needed, and keep climbing the TreeGrow leaderboard.");
  const location = clean(qs.location, "https://treegrow.xyz/#garden-sec");
  const wallet = clean(qs.wallet, "wallet").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "wallet";

  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TreeGrow//Arboretum Reminder//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:treegrow-${wallet}-${Math.max(0, startMs)}@treegrow.xyz`,
    `DTSTAMP:${icsDate(Date.now())}`,
    `DTSTART:${icsDate(startMs)}`,
    `DTEND:${icsDate(endMs)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${details}`,
    `LOCATION:${location}`,
    `URL:${location}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${title}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="treegrow-watering-reminder.ics"',
      "Cache-Control": "no-store",
    },
    body,
  };
};

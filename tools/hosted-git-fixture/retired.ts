/** Retirement deployment has no Durable Object exports or resource bindings. */
export default {
  fetch() {
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  },
};

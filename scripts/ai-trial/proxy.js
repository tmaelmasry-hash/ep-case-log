// Local-only bridge from scripts/ai-trial/eval.mjs to Workers AI: run with `wrangler dev`, never deployed. Made-up notes only.
export default {
  async fetch(req, env) {
    const { model, inputs } = await req.json();
    try {
      return Response.json(await env.AI.run(model, inputs));
    } catch (e) {
      return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
    }
  },
};

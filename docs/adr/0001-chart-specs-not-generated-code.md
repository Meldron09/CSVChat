# Charts are declarative Chart Specs, not LLM-generated plotting code

The Chart Builder fills a validated Chart Spec (type, axes, series, title, data) and the frontend draws it with Recharts. We rejected having the LLM write matplotlib/Plotly code that the server executes and returns as an image. Executing model-written code needs a sandbox and is a security risk, and an image can't be stored compactly in the LangGraph checkpoint, whereas a spec can, so charts re-render when a Chat is resumed.

## Consequences

- Chart variety is limited to the types the spec supports (line, bar, pie, scatter); anything fancier needs a new spec type and frontend renderer.
- Chart Specs are persisted in checkpoint state so the transcript rebuilds from the checkpointer alone.

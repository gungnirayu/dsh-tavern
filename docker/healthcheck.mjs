const port = Number(process.env.DSH_TAVERN_PORT || 3081);
try {
  for (const target of [port, 3080]) {
    const response = await fetch(`http://127.0.0.1:${target}/`, {signal: AbortSignal.timeout(1800)});
    if (!response.ok && response.status !== 401) process.exit(1);
  }
} catch { process.exit(1); }

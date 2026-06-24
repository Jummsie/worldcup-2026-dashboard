const BASE = "https://api.football-data.org/v4";
const KEY = process.env.FOOTBALL_DATA_API_KEY!;

const hdrs = { "X-Auth-Token": KEY };

async function fd(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: hdrs,
    next: { revalidate: 55 }, // cache 55s server-side — respects the 10 req/min free tier limit
  });
  if (!res.ok) throw new Error(`football-data ${path} → ${res.status}`);
  return res.json();
}

export async function GET() {
  try {
    const [comp, scorersData, matchesData] = await Promise.all([
      fd("/competitions/WC/standings?season=2026"),
      fd("/competitions/WC/scorers?season=2026&limit=20"),
      fd("/competitions/WC/matches?season=2026"),
    ]);

    // Build a map of TLA → group letter from match data (free tier doesn't include group in standings)
    const tlaToGroup: Record<string, string> = {};
    for (const m of matchesData.matches) {
      const g: string | null = m.group;
      if (g) {
        const letter = g.replace("GROUP_", "");
        tlaToGroup[m.homeTeam.tla] = letter;
        tlaToGroup[m.awayTeam.tla] = letter;
      }
    }

    // Attach group letter to each standings row
    const totalStandings = comp.standings.find(
      (s: { type: string }) => s.type === "TOTAL"
    );

    const groupMap: Record<string, typeof totalStandings.table> = {};
    for (const row of totalStandings?.table ?? []) {
      const letter = tlaToGroup[row.team.tla];
      if (letter) {
        (groupMap[letter] ??= []).push(row);
      }
    }

    // Sort each group by points → goal diff → goals for
    for (const rows of Object.values(groupMap)) {
      rows.sort(
        (a: { points: number; goalDifference: number; goalsFor: number },
         b: { points: number; goalDifference: number; goalsFor: number }) =>
          b.points - a.points ||
          b.goalDifference - a.goalDifference ||
          b.goalsFor - a.goalsFor
      );
    }

    return Response.json(
      { groupMap, scorers: scorersData.scorers, matches: matchesData.matches },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}

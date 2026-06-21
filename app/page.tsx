"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/* ── Types ── */
interface Team { name: string; shortName: string; tla: string; }
interface TableRow {
  position: number;
  team: Team;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}
interface Scorer {
  player: { name: string };
  team: Team;
  goals: number;
  assists: number | null;
}
interface Match {
  id: number;
  utcDate: string;
  status: "TIMED" | "SCHEDULED" | "IN_PLAY" | "PAUSED" | "FINISHED" | "POSTPONED" | "CANCELLED";
  stage: string;
  group: string | null;
  homeTeam: Team;
  awayTeam: Team;
  score: {
    fullTime: { home: number | null; away: number | null };
  };
}
interface ApiData {
  groupMap: Record<string, TableRow[]>;
  scorers: Scorer[];
  matches: Match[];
}

const TABS = ["standings", "fixtures", "goals", "bracket", "scorers", "assists", "keepers"] as const;
type Tab = typeof TABS[number];

const GLOVE_FAVOURITES = [
  ["Emiliano Martínez", "Argentina", "+450 · defending winner"],
  ["Unai Simón", "Spain", "co-favourite"],
  ["Alisson", "Brazil", "title contender"],
  ["Thibaut Courtois", "Belgium", "elite shot-stopper"],
  ["Jordan Pickford", "England", "England No.1"],
  ["Matt Turner", "USA", "host-nation hope"],
];

const POLL_LIVE = 30_000;
const POLL_IDLE = 60_000;

function fmtDate(utc: string) {
  return new Date(utc).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
  });
}
function fmtTime(utc: string) {
  return new Date(utc).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function isLive(s: Match["status"]) { return s === "IN_PLAY" || s === "PAUSED"; }
function isFinished(s: Match["status"]) { return s === "FINISHED"; }

export default function Dashboard() {
  const [data, setData] = useState<ApiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState("");
  const [tab, setTab] = useState<Tab>("standings");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/worldcup");
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json as ApiData);
      setError(null);
      setLastUpdated(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
      const anyLive = (json as ApiData).matches.some((m) => isLive(m.status));
      timerRef.current = setTimeout(fetchData, anyLive ? POLL_LIVE : POLL_IDLE);
    } catch (e) {
      setError((e as Error).message);
      timerRef.current = setTimeout(fetchData, POLL_IDLE);
    }
  }, []);

  useEffect(() => {
    fetchData();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [fetchData]);

  /* ── Derived data ── */
  const groupEntries = Object.entries(data?.groupMap ?? {}).sort(([a], [b]) => a.localeCompare(b));

  // Bracket
  const allMatches = data?.matches ?? [];
  const r32  = allMatches.filter((m) => m.stage === "LAST_32");
  const r16  = allMatches.filter((m) => m.stage === "LAST_16");
  const qf   = allMatches.filter((m) => m.stage === "QUARTER_FINALS");
  const sf   = allMatches.filter((m) => m.stage === "SEMI_FINALS");
  const fin  = allMatches.filter((m) => m.stage === "FINAL");

  function BracketSlot({ m, i }: { m?: Match; i: number }) {
    if (!m) return <div key={i} className="slot">TBD</div>;
    const finished = isFinished(m.status);
    const home = m.homeTeam?.shortName ?? "TBD";
    const away = m.awayTeam?.shortName ?? "TBD";
    const known = home !== "TBD" && away !== "TBD";
    return (
      <div className={`slot${known ? " known" : ""}`}>
        {home} {finished ? `${m.score.fullTime.home}–${m.score.fullTime.away}` : "vs"} {away}
      </div>
    );
  }

  function placeholders(count: number, label: string) {
    return Array.from({ length: count }, (_, i) => (
      <div key={i} className="slot">{label} {i + 1}</div>
    ));
  }

  const matchesByDate: Record<string, Match[]> = {};
  (data?.matches ?? [])
    .filter((m) => m.stage === "GROUP_STAGE")
    .forEach((m) => {
      const d = fmtDate(m.utcDate);
      (matchesByDate[d] ??= []).push(m);
    });
  const sortedDates = Object.keys(matchesByDate).sort(
    (a, b) => new Date(matchesByDate[a][0].utcDate).getTime() - new Date(matchesByDate[b][0].utcDate).getTime()
  );

  const teamGoalMap: Record<string, { name: string; tla: string; goals: number }> = {};
  (data?.matches ?? []).filter((m) => isFinished(m.status) || isLive(m.status)).forEach((m) => {
    const hg = m.score.fullTime.home ?? 0;
    const ag = m.score.fullTime.away ?? 0;
    for (const [tla, name, goals] of [
      [m.homeTeam.tla, m.homeTeam.shortName, hg],
      [m.awayTeam.tla, m.awayTeam.shortName, ag],
    ] as [string, string, number][]) {
      if (!teamGoalMap[tla]) teamGoalMap[tla] = { name, tla, goals: 0 };
      teamGoalMap[tla].goals += goals;
    }
  });
  const teamGoals = Object.values(teamGoalMap).filter((t) => t.goals > 0).sort((a, b) => b.goals - a.goals);
  const maxGoals = teamGoals[0]?.goals ?? 1;

  const scorers = data?.scorers ?? [];
  const assistLeaders = [...scorers]
    .filter((s) => (s.assists ?? 0) > 0)
    .sort((a, b) => (b.assists ?? 0) - (a.assists ?? 0));

  // Keystats
  const topGoals = scorers[0]?.goals ?? 0;
  const topScorers = scorers.filter((s) => s.goals === topGoals);
  const onTwoGoals = scorers.filter((s) => s.goals === 2);
  const messiGoals = scorers.find((s) => s.player.name.includes("Messi"))?.goals;

  const anyLiveNow = data?.matches.some((m) => isLive(m.status));

  return (
    <>
      <header>
        <div className="wrap">
          <div className="hero">
            <div className="eyebrow">
              <span className="live-dot" />
              {anyLiveNow ? "Live · Match in progress" : "Live · Group Stage"}
              {lastUpdated && <span className="refresh-badge">Updated {lastUpdated}</span>}
            </div>
            <h1>World Cup<span className="l2">2026</span></h1>
            <p className="sub">
              <b>USA · Canada · Mexico</b> &nbsp;/&nbsp; 48 teams &nbsp;/&nbsp; 12 groups
              <br />Final — 19 July &nbsp;·&nbsp; <b>MetLife Stadium</b>
            </p>
          </div>
        </div>
      </header>

      <nav>
        <div className="wrap">
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
                {t === "standings" && "Standings"}
                {t === "fixtures" && "Fixtures & Results"}
                {t === "goals" && "Goals / Team"}
                {t === "bracket" && "Bracket"}
                {t === "scorers" && "Top Scorers"}
                {t === "assists" && "Assists"}
                {t === "keepers" && "Goalkeepers"}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* STANDINGS */}
      <div className={`section${tab === "standings" ? " show" : ""}`}>
        <div className="wrap">
          <h2 className="sectitle">Group Standings</h2>
          <p className="secnote">Top 2 of each group + 8 best third-placed teams advance to Round of 32</p>
          {error && <div className="error-box">⚠ {error} — showing last known data</div>}
          {!data ? (
            <div className="loading">Loading standings…</div>
          ) : (
            <div className="groups">
              {groupEntries.map(([letter, rows]) => (
                <div className="group" key={letter}>
                  <div className="ghead">
                    <span className="gbadge">{letter}</span>
                    <h3>Group {letter}</h3>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th className="r">#</th>
                        <th>Team</th>
                        <th className="c">W</th>
                        <th className="c">D</th>
                        <th className="c">L</th>
                        <th className="p">Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={row.team.tla} className={i < 2 ? "qual" : ""}>
                          <td className="r pos">{i + 1}</td>
                          <td>
                            <span className="team-name">{row.team.shortName}</span>
                            <span className="abbr">{row.team.tla}</span>
                          </td>
                          <td className="c">{row.won}</td>
                          <td className="c">{row.draw}</td>
                          <td className="c">{row.lost}</td>
                          <td className="p pts">{row.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
          <div className="legend">
            <span className="swatch" /> Currently in a top-two qualifying position
          </div>
        </div>
      </div>

      {/* FIXTURES */}
      <div className={`section${tab === "fixtures" ? " show" : ""}`}>
        <div className="wrap">
          <h2 className="sectitle">Fixtures &amp; Results</h2>
          <p className="secnote">Final scores and upcoming matches</p>
          {!data ? (
            <div className="loading">Loading fixtures…</div>
          ) : (
            sortedDates.map((date) => (
              <div className="fxday" key={date}>
                <div className="fxdate">{date}</div>
                {matchesByDate[date].map((m) => {
                  const live = isLive(m.status);
                  const finished = isFinished(m.status);
                  return (
                    <div className={`fx${live ? " live-m" : ""}`} key={m.id}>
                      <div className="side home">
                        {m.homeTeam.shortName}
                        <span className="abbr">{m.homeTeam.tla}</span>
                      </div>
                      {finished || live ? (
                        <div className="sc">
                          {m.score.fullTime.home ?? 0} – {m.score.fullTime.away ?? 0}
                        </div>
                      ) : (
                        <div className="when">{fmtTime(m.utcDate)}</div>
                      )}
                      <div className="side away">
                        <span className="abbr">{m.awayTeam.tla}</span>
                        {m.awayTeam.shortName}
                        {finished && <span className="tag ft">FT</span>}
                        {live && <span className="tag lv">Live</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* GOALS PER TEAM */}
      <div className={`section${tab === "goals" ? " show" : ""}`}>
        <div className="wrap">
          <h2 className="sectitle">Goals Per Team</h2>
          <p className="secnote">Total goals scored so far · group stage</p>
          {!data ? (
            <div className="loading">Loading…</div>
          ) : teamGoals.length === 0 ? (
            <div className="loading">No goals scored yet</div>
          ) : (
            <div className="bars">
              {teamGoals.map((t) => (
                <div className="bar-row" key={t.tla}>
                  <div className="bar-team">
                    {t.name} <span className="abbr">{t.tla}</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(t.goals / maxGoals) * 100}%` }}>
                      {t.goals}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* BRACKET */}
      <div className={`section${tab === "bracket" ? " show" : ""}`}>
        <div className="wrap">
          <h2 className="sectitle">Knockout Bracket</h2>
          <p className="secnote">First-ever Round of 32 in the 48-team format · final at MetLife Stadium, 19 July</p>
          <div className="bracket-intro">
            The bracket fills in once the group stage finishes. With matchdays still being played, the 32 qualifiers
            aren't locked yet — but here's the road to the final every team is chasing.
          </div>
          {!data ? (
            <div className="loading">Loading…</div>
          ) : (
            <div className="rounds">
              <div className="rnd">
                <h4>Round of 32</h4>
                {r32.length ? r32.map((m, i) => <BracketSlot key={m.id ?? i} m={m} i={i} />) : placeholders(8, "Match")}
              </div>
              <div className="rnd">
                <h4>Round of 16</h4>
                {r16.length ? r16.map((m, i) => <BracketSlot key={m.id ?? i} m={m} i={i} />) : placeholders(4, "Match")}
              </div>
              <div className="rnd">
                <h4>Quarter-finals</h4>
                {qf.length ? qf.map((m, i) => <BracketSlot key={m.id ?? i} m={m} i={i} />) : placeholders(2, "QF")}
              </div>
              <div className="rnd">
                <h4>Semi-finals</h4>
                {sf.length ? sf.map((m, i) => <BracketSlot key={m.id ?? i} m={m} i={i} />) : placeholders(1, "SF")}
              </div>
              <div className="rnd">
                <h4>Final</h4>
                {fin.length ? fin.map((m, i) => <BracketSlot key={m.id ?? i} m={m} i={i} />) : <div className="slot final">Champion 2026</div>}
                <div className="trophy">🏆</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* TOP SCORERS */}
      <div className={`section${tab === "scorers" ? " show" : ""}`}>
        <div className="wrap">
          <h2 className="sectitle">Golden Boot Race</h2>
          <p className="secnote">Most goals · ties broken by assists, then fewest minutes played</p>
          {data && (
            <div className="keystats">
              <div className="kstat">
                <div className="big">{topGoals}</div>
                <div className="lbl">Leaders&apos; Goals</div>
                <div className="who">{topScorers.map((s) => s.player.name).join(" & ")}</div>
              </div>
              <div className="kstat">
                <div className="big">{onTwoGoals.length}</div>
                <div className="lbl">Players on 2 Goals</div>
                <div className="who">{onTwoGoals.slice(0, 3).map((s) => s.player.name.split(" ").pop()).join(", ")}…</div>
              </div>
              <div className="kstat">
                <div className="big">{topScorers.length}</div>
                <div className="lbl">Players on {topGoals} Goals</div>
                <div className="who">{topScorers.map((s) => s.player.name.split(" ").pop()).join(", ")}</div>
              </div>
            </div>
          )}
          {!data ? (
            <div className="loading">Loading scorers…</div>
          ) : (
            <div className="board-grid">
              <div className="board">
                <div className="board-h">
                  <h3>Leading Scorers</h3>
                  <span className="award">adidas Golden Boot</span>
                </div>
                <p className="board-note">Goals scored · group stage</p>
                {scorers.map((s, i) => (
                  <div className={`row${i === 0 ? " top" : ""}`} key={`${s.player.name}-${i}`}>
                    <div className="rank">{i + 1}</div>
                    <div className="pinfo">
                      <div className="pname">{s.player.name}</div>
                      <div className="pteam">{s.team.shortName}</div>
                    </div>
                    <div className="stat">{s.goals}<small>goals</small></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ASSISTS */}
      <div className={`section${tab === "assists" ? " show" : ""}`}>
        <div className="wrap">
          <h2 className="sectitle">Assist Leaders</h2>
          <p className="secnote">Goals created for teammates</p>
          {!data ? (
            <div className="loading">Loading…</div>
          ) : (
            <div className="board-grid">
              <div className="board">
                <div className="board-h">
                  <h3>Most Assists</h3>
                  <span className="award">Playmakers</span>
                </div>
                <p className="board-note">Assists · group stage</p>
                {assistLeaders.length === 0 ? (
                  <p style={{ color: "var(--mut)", fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>
                    No assist data yet
                  </p>
                ) : (
                  assistLeaders.map((s, i) => (
                    <div className={`row${i === 0 ? " top" : ""}`} key={`${s.player.name}-${i}`}>
                      <div className="rank">{i + 1}</div>
                      <div className="pinfo">
                        <div className="pname">{s.player.name}</div>
                        <div className="pteam">{s.team.shortName}</div>
                      </div>
                      <div className="stat">{s.assists}<small>assists</small></div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* GOALKEEPERS */}
      <div className={`section${tab === "keepers" ? " show" : ""}`}>
        <div className="wrap">
          <h2 className="sectitle">Between the Sticks</h2>
          <p className="secnote">The Golden Glove is chosen by FIFA's panel, not a single stat — but saves tell the story</p>
          <div className="board-grid">
            <div className="board">
              <div className="board-h">
                <h3>Golden Glove Favourites</h3>
                <span className="award">Best Goalkeeper</span>
              </div>
              <p className="board-note">Bookmakers' shortlist · live odds</p>
              {GLOVE_FAVOURITES.map(([name, team, note], i) => (
                <div className={`row${i === 0 ? " top" : ""}`} key={name}>
                  <div className="rank">{i + 1}</div>
                  <div className="pinfo">
                    <div className="pname">{name}</div>
                    <div className="pteam">{team}</div>
                  </div>
                  <div className="stat" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "var(--mut)", textAlign: "right", maxWidth: 120 }}>
                    {note}
                  </div>
                </div>
              ))}
            </div>
            <div className="board">
              <div className="board-h">
                <h3>Why Saves Matter</h3>
                <span className="award">Context</span>
              </div>
              <p className="board-note">Save totals lean on how exposed a defence is</p>
              <p style={{ fontSize: 14, color: "var(--mut)", lineHeight: 1.75 }}>
                A save counts only when a shot heading into the net is stopped. Keepers behind busy defences rack up
                the biggest totals, while title-chasers win the Golden Glove on clean sheets and clutch knockout
                saves — in four of the last five World Cups it went to a player from the champion nation.
              </p>
            </div>
          </div>
        </div>
      </div>

      <footer>
        <div className="wrap">
          Live data via football-data.org · auto-refreshes every{" "}
          {anyLiveNow ? "30s during live matches" : "60s"} · group stage in progress.
          <br />
          A fan-made dashboard · World Cup 2026 · USA / Canada / Mexico
        </div>
      </footer>
    </>
  );
}

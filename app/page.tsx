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

const TABS = ["standings", "fixtures", "goals", "bracket", "scorers", "assists", "myteam"] as const;
type Tab = typeof TABS[number];

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
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const [myPicksView, setMyPicksView] = useState<"live" | "picks">("live");
  const [myPicks, setMyPicks] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const saved = localStorage.getItem('wc26mp');
      if (saved) setMyPicks(JSON.parse(saved));
    } catch {}
  }, []);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/worldcup", { cache: "no-store" });
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
  const allMatches = data?.matches ?? [];

  const knockoutMatches = allMatches.filter((m) => m.stage !== "GROUP_STAGE");
  const knockoutStarted = knockoutMatches.some((m) => isFinished(m.status) || isLive(m.status));
  const eliminatedTLAs = new Set<string>();
  if (knockoutStarted) {
    knockoutMatches.filter((m) => isFinished(m.status)).forEach((m) => {
      const hg = m.score.fullTime.home ?? 0;
      const ag = m.score.fullTime.away ?? 0;
      if (hg !== ag) eliminatedTLAs.add(hg < ag ? m.homeTeam.tla : m.awayTeam.tla);
    });
  }

  const r32 = allMatches.filter((m) => m.stage === "LAST_32");
  const r16 = allMatches.filter((m) => m.stage === "LAST_16");
  const qf  = allMatches.filter((m) => m.stage === "QUARTER_FINALS");
  const sf  = allMatches.filter((m) => m.stage === "SEMI_FINALS");
  const fin = allMatches.filter((m) => m.stage === "FINAL");

  // My Picks: derive R32 display order from the actual R16 bracket data.
  // Sort R32 and R16 by match ID (sequential per FIFA numbering).
  // For each R16 slot, find which R32 winners feed it by matching confirmed teams.
  // Remaining (unfinished) R32 matches are assigned to remaining R16 slots in ID order.
  // This groups consecutive R32 display pairs to feed the correct R16 slot, so the
  // simple Math.floor(idx/2) cascade formula holds for all subsequent rounds.
  const r32ById = [...r32].sort((a, b) => a.id - b.id);
  const r16ById = [...r16].sort((a, b) => a.id - b.id);
  const winnerToR32Idx: Record<string, number> = {};
  r32ById.forEach((m, i) => {
    if (isFinished(m.status)) {
      const hg = m.score.fullTime.home ?? 0, ag = m.score.fullTime.away ?? 0;
      if (hg !== ag) winnerToR32Idx[hg > ag ? m.homeTeam.tla : m.awayTeam.tla] = i;
    }
  });
  const usedR32Indices = new Set<number>();
  const picksDisplayOrder: number[] = [];
  for (const m16 of r16ById) {
    const hi = winnerToR32Idx[m16.homeTeam?.tla ?? ""] ?? -1;
    const ai = winnerToR32Idx[m16.awayTeam?.tla ?? ""] ?? -1;
    const avail = () => r32ById.map((_, i) => i).filter(i => !usedR32Indices.has(i));
    let homeR32 = (hi >= 0 && !usedR32Indices.has(hi)) ? hi : (avail().find(i => i !== ai) ?? -1);
    let awayR32 = (ai >= 0 && !usedR32Indices.has(ai)) ? ai : (avail().find(i => i !== homeR32) ?? -1);
    if (homeR32 >= 0) usedR32Indices.add(homeR32);
    if (awayR32 >= 0) usedR32Indices.add(awayR32);
    picksDisplayOrder.push(homeR32, awayR32);
  }
  const r32ForPicks = picksDisplayOrder.map(i => r32ById[i]).filter((m): m is Match => !!m);

  function getMyPickTeam(round: number, matchIdx: number, isHome: boolean): string | null {
    if (round === 0) {
      const m = r32ForPicks[matchIdx];
      if (!m) return null;
      const t = isHome ? m.homeTeam : m.awayTeam;
      return t?.shortName && t.shortName !== "TBD" ? t.shortName : null;
    }
    const prevMatch = matchIdx * 2 + (isHome ? 0 : 1);
    return myPicks[`${round - 1}-${prevMatch}`] ?? null;
  }

  function doMyPick(round: number, matchIdx: number, team: string) {
    const key = `${round}-${matchIdx}`;
    const old = myPicks[key];
    const np = { ...myPicks, [key]: team };
    if (old && old !== team) {
      let ni = Math.floor(matchIdx / 2);
      for (let nr = round + 1; nr <= 4; nr++) {
        const nk = `${nr}-${ni}`;
        if (np[nk] === old) { delete np[nk]; ni = Math.floor(ni / 2); }
        else break;
      }
    }
    setMyPicks(np);
    localStorage.setItem('wc26mp', JSON.stringify(np));
  }

  /* ── Live bracket components (read-only) ── */
  function LiveMatchupCard({ m }: { m?: Match }) {
    const finished = m ? isFinished(m.status) : false;
    const live     = m ? isLive(m.status) : false;
    const hs = m?.score.fullTime.home ?? null;
    const as_ = m?.score.fullTime.away ?? null;
    const homeName = m?.homeTeam?.shortName && m.homeTeam.shortName !== "TBD" ? m.homeTeam.shortName : "TBD";
    const awayName = m?.awayTeam?.shortName && m.awayTeam.shortName !== "TBD" ? m.awayTeam.shortName : "TBD";
    const homeWon = finished && hs !== null && as_ !== null && hs > as_;
    const awayWon = finished && hs !== null && as_ !== null && as_ > hs;
    return (
      <div className="bmatch-group">
        {m && <div className="bmatch-date">{fmtDate(m.utcDate)}</div>}
        <div className={`bteam${homeName === "TBD" ? " tbd" : homeWon ? " winner" : finished ? " loser" : ""}`}>
          {homeName}{(finished || live) && hs !== null && <span className="bscore">{hs}</span>}
        </div>
        <div className="bteam-divider" />
        <div className={`bteam${awayName === "TBD" ? " tbd" : awayWon ? " winner" : finished ? " loser" : ""}`}>
          {awayName}{(finished || live) && as_ !== null && <span className="bscore">{as_}</span>}
        </div>
      </div>
    );
  }

  function LiveBracketRound({ matches, count, label }: { matches: Match[]; count: number; label: string }) {
    const items: (Match | undefined)[] = matches.length ? matches : Array(count).fill(undefined);
    const pairs: (Match | undefined)[][] = [];
    for (let i = 0; i < items.length; i += 2) pairs.push([items[i], items[i + 1]]);
    return (
      <div className="rnd">
        <h4>{label}</h4>
        <div className="rnd-matches">
          {pairs.map((pair, pi) => (
            <div key={pi} className="bracket-pair">
              {pair.map((m, mi) => (
                <div key={mi} className="bracket-pair-item">
                  <LiveMatchupCard m={m} />
                </div>
              ))}
              {pair.length === 2 && <div className="bracket-pair-vline" />}
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── My Picks components ── */
  function MyPickCard({ round, matchIdx }: { round: number; matchIdx: number }) {
    const homeTeam = getMyPickTeam(round, matchIdx, true);
    const awayTeam = getMyPickTeam(round, matchIdx, false);
    const pick = myPicks[`${round}-${matchIdx}`];
    const homeTbd = !homeTeam;
    const awayTbd = !awayTeam;
    const homePicked = pick === homeTeam && !homeTbd;
    const awayPicked = pick === awayTeam && !awayTbd;
    const canPick = !homeTbd && !awayTbd;
    return (
      <div className="bmatch-group">
        <div
          className={`bteam${homeTbd ? " tbd" : homePicked ? " winner" : ""}${canPick && !homeTbd ? " pickable" : ""}`}
          onClick={() => canPick && homeTeam && doMyPick(round, matchIdx, homeTeam)}
        >
          {homeTeam ?? "TBD"}
        </div>
        <div className="bteam-divider" />
        <div
          className={`bteam${awayTbd ? " tbd" : awayPicked ? " winner" : ""}${canPick && !awayTbd ? " pickable" : ""}`}
          onClick={() => canPick && awayTeam && doMyPick(round, matchIdx, awayTeam)}
        >
          {awayTeam ?? "TBD"}
        </div>
      </div>
    );
  }

  function MyPicksRound({ count, label, round }: { count: number; label: string; round: number }) {
    if (count === 1) {
      return (
        <div className="rnd">
          <h4>{label}</h4>
          <div className="rnd-matches">
            <div className="bracket-pair">
              <div className="bracket-pair-item"><MyPickCard round={round} matchIdx={0} /></div>
            </div>
          </div>
        </div>
      );
    }
    const pairs: [number, number][] = [];
    for (let i = 0; i < count; i += 2) pairs.push([i, i + 1]);
    return (
      <div className="rnd">
        <h4>{label}</h4>
        <div className="rnd-matches">
          {pairs.map(([a, b], pi) => (
            <div key={pi} className="bracket-pair">
              <div className="bracket-pair-item"><MyPickCard round={round} matchIdx={a} /></div>
              <div className="bracket-pair-item"><MyPickCard round={round} matchIdx={b} /></div>
              <div className="bracket-pair-vline" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── Fixtures data ── */
  const matchesByDate: Record<string, Match[]> = {};
  (data?.matches ?? []).forEach((m) => {
    const d = fmtDate(m.utcDate);
    (matchesByDate[d] ??= []).push(m);
  });
  const allSortedDates = Object.keys(matchesByDate).sort(
    (a, b) => new Date(matchesByDate[a][0].utcDate).getTime() - new Date(matchesByDate[b][0].utcDate).getTime()
  );
  const knockoutFixtureDates = allSortedDates.filter(d => matchesByDate[d].some(m => m.stage !== "GROUP_STAGE"));
  const groupStageDates = allSortedDates.filter(d => matchesByDate[d].every(m => m.stage === "GROUP_STAGE"));

  /* ── Stats ── */
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

  const topGoals = scorers[0]?.goals ?? 0;
  const topScorers = scorers.filter((s) => s.goals === topGoals);
  const secondGoals = scorers.find((s) => s.goals < topGoals)?.goals ?? 0;
  const onSecondGoals = secondGoals > 0 ? scorers.filter((s) => s.goals === secondGoals) : [];

  const anyLiveNow = data?.matches.some((m) => isLive(m.status));

  function FixtureDay({ date }: { date: string }) {
    return (
      <div className="fxday" key={date}>
        <div className="fxdate">{date}</div>
        {matchesByDate[date].map((m) => {
          const live = isLive(m.status);
          const finished = isFinished(m.status);
          return (
            <div className={`fx${live ? " live-m" : ""}`} key={m.id}>
              <div className="side home">
                <span className="tn">{m.homeTeam.shortName}</span>
                <span className="abbr">{m.homeTeam.tla}</span>
              </div>
              {finished || live ? (
                <div className="sc">
                  {m.score.fullTime.home ?? 0} – {m.score.fullTime.away ?? 0}
                  {finished && <div className="sc-tag">FT</div>}
                  {live && <div className="sc-tag lv">Live</div>}
                </div>
              ) : (
                <div className="when">{fmtTime(m.utcDate)}</div>
              )}
              <div className="side away">
                <span className="abbr">{m.awayTeam.tla}</span>
                <span className="tn">{m.awayTeam.shortName}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <header>
        <div className="wrap">
          <div className="hero">
            <div className="eyebrow">
              <span className="live-dot" />
              {anyLiveNow ? "Live · Match in progress" : "Live · Knockout Stage"}
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
          <div className="tabs-wrap">
            <div className="tabs">
              {TABS.map((t) => (
                <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
                  {t === "standings" && "Standings"}
                  {t === "fixtures" && "Fixtures & Results"}
                  {t === "goals" && "Goals / Team"}
                  {t === "bracket" && "Bracket"}
                  {t === "scorers" && "Top Scorers"}
                  {t === "assists" && "Assists"}
                  {t === "myteam" && "My Team"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {/* STANDINGS */}
      <div className={`section${tab === "standings" ? " show" : ""}`}>
        <div className="wrap">
          <h2 className="sectitle">Group Standings</h2>
          <p className="secnote">Final group stage standings — top 2 of each group + 8 best third-placed teams advanced to Round of 32</p>
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
            <span className="swatch" /> Top-two qualifying position
          </div>
        </div>
      </div>

      {/* FIXTURES */}
      <div className={`section${tab === "fixtures" ? " show" : ""}`}>
        <div className="wrap">
          <h2 className="sectitle">Fixtures &amp; Results</h2>
          <p className="secnote">Knockout stage · group stage results below</p>
          {!data ? (
            <div className="loading">Loading fixtures…</div>
          ) : (<>
            {/* Live matches pinned to top */}
            {allMatches.filter((m) => isLive(m.status)).length > 0 && (
              <div className="fxday live-day">
                <div className="fxdate live-date-label">🟢 LIVE NOW</div>
                {allMatches.filter((m) => isLive(m.status)).map((m) => (
                  <div className="fx live-m" key={m.id}>
                    <div className="side home"><span className="tn">{m.homeTeam.shortName}</span><span className="abbr">{m.homeTeam.tla}</span></div>
                    <div className="sc">{m.score.fullTime.home ?? 0} – {m.score.fullTime.away ?? 0}</div>
                    <div className="side away"><span className="abbr">{m.awayTeam.tla}</span><span className="tn">{m.awayTeam.shortName}</span></div>
                  </div>
                ))}
              </div>
            )}
            {/* Knockout matches */}
            {knockoutFixtureDates.map((date) => <FixtureDay key={date} date={date} />)}
            {/* Group stage archive */}
            {groupStageDates.length > 0 && (
              <>
                <div style={{ margin: "32px 0 12px", borderTop: "1px solid rgba(255,255,255,.07)", paddingTop: 24 }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--mut2)", marginBottom: 4 }}>
                    Group Stage — Final Results
                  </div>
                </div>
                {groupStageDates.map((date) => <FixtureDay key={date} date={date} />)}
              </>
            )}
          </>
          )}
        </div>
      </div>

      {/* GOALS PER TEAM */}
      <div className={`section${tab === "goals" ? " show" : ""}`}>
        <div className="wrap">
          <h2 className="sectitle">Goals Per Team</h2>
          <p className="secnote">Total goals scored across all stages</p>
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

          {/* Sub-tab toggle */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--line)", marginBottom: 20 }}>
            {(["live", "picks"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setMyPicksView(v)}
                style={{
                  background: "none", border: "none",
                  borderBottom: myPicksView === v ? "2px solid var(--green)" : "2px solid transparent",
                  color: myPicksView === v ? "var(--green)" : "var(--mut)",
                  fontFamily: "'JetBrains Mono',monospace", fontSize: 11,
                  letterSpacing: ".08em", textTransform: "uppercase",
                  padding: "8px 14px", marginBottom: -1, cursor: "pointer",
                }}
              >
                {v === "live" ? "Live Bracket" : "My Picks"}
              </button>
            ))}
          </div>

          {!data ? (
            <div className="loading">Loading…</div>
          ) : myPicksView === "live" ? (
            <div className="bracket-scroll">
              <div className="rounds">
                <LiveBracketRound matches={r32} count={16} label="Round of 32" />
                <LiveBracketRound matches={r16} count={8}  label="Round of 16" />
                <LiveBracketRound matches={qf}  count={4}  label="Quarter-finals" />
                <LiveBracketRound matches={sf}  count={2}  label="Semi-finals" />
                <div className="rnd">
                  <h4>Final</h4>
                  <div className="rnd-matches">
                    <div className="bracket-pair">
                      <div className="bracket-pair-item">
                        <LiveMatchupCard m={fin[0]} />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rnd">
                  <h4>Champion</h4>
                  <div className="rnd-matches">
                    <div className="bracket-champion">
                      <div className="trophy-icon">🏆</div>
                      {fin[0] && isFinished(fin[0].status) ? (() => {
                        const hs = fin[0].score.fullTime.home ?? 0;
                        const as_ = fin[0].score.fullTime.away ?? 0;
                        const champ = hs > as_ ? fin[0].homeTeam : fin[0].awayTeam;
                        return <>
                          <div className="champ-label">World Champion</div>
                          <div className="champ-name" style={{ color: "var(--green)", fontWeight: 700, fontSize: 14 }}>{champ.shortName}</div>
                        </>;
                      })() : <>
                        <div className="champ-label">Champion 2026</div>
                        <div className="champ-name">19 July · MetLife</div>
                      </>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* My Picks */
            <>
              <p style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "var(--mut)", marginBottom: 12 }}>
                Pick your predicted winners — independent of real results, just for fun.
              </p>
              {Object.keys(myPicks).length > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                  <button
                    className="bracket-reset-btn"
                    onClick={() => { setMyPicks({}); localStorage.removeItem('wc26mp'); }}
                  >
                    Reset picks
                  </button>
                </div>
              )}
              <div className="bracket-scroll">
                <div className="rounds">
                  <MyPicksRound count={16} label="Round of 32" round={0} />
                  <MyPicksRound count={8}  label="Round of 16" round={1} />
                  <MyPicksRound count={4}  label="Quarter-finals" round={2} />
                  <MyPicksRound count={2}  label="Semi-finals" round={3} />
                  <MyPicksRound count={1}  label="Final" round={4} />
                  <div className="rnd">
                    <h4>Champion</h4>
                    <div className="rnd-matches">
                      <div className="bracket-champion">
                        <div className="trophy-icon">🏆</div>
                        {myPicks["4-0"] ? <>
                          <div className="champ-label">Your Pick</div>
                          <div className="champ-name" style={{ color: "var(--green)", fontWeight: 700, fontSize: 14 }}>{myPicks["4-0"]}</div>
                        </> : <>
                          <div className="champ-label">Pick your champion</div>
                          <div className="champ-name">19 July · MetLife</div>
                        </>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
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
                <div className="big">{onSecondGoals.length}</div>
                <div className="lbl">Players on {secondGoals} Goals</div>
                <div className="who">{onSecondGoals.slice(0, 3).map((s) => s.player.name.split(" ").pop()).join(", ")}{onSecondGoals.length > 3 ? "…" : ""}</div>
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
                <p className="board-note">Goals scored · all stages</p>
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
                <p className="board-note">Assists · all stages</p>
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

      {/* MY TEAM */}
      <div className={`section${tab === "myteam" ? " show" : ""}`}>
        <div className="wrap">
          <h2 className="sectitle">My Team</h2>
          <p className="secnote">Select a nation to follow their full World Cup journey</p>

          <div className="team-select-wrap">
            <label className="team-select-label" htmlFor="team-pick">Choose your team</label>
            <select
              id="team-pick"
              className="team-select"
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
            >
              <option value="">— Select a team —</option>
              {Object.entries(data?.groupMap ?? {})
                .sort(([a], [b]) => a.localeCompare(b))
                .flatMap(([, rows]) => rows)
                .filter((row) => !eliminatedTLAs.has(row.team.tla))
                .sort((a, b) => a.team.name.localeCompare(b.team.name))
                .map((row) => (
                  <option key={row.team.tla} value={row.team.tla}>
                    {row.team.name} ({row.team.tla})
                  </option>
                ))}
            </select>
          </div>

          {selectedTeam && eliminatedTLAs.has(selectedTeam) && (
            <div className="eliminated-notice">
              ⚽ {selectedTeam} have been eliminated from the tournament. Select another team above.
            </div>
          )}

          {!selectedTeam ? (
            <div className="no-team">
              Select a team above to see their fixtures,<br />results and knockout journey.
            </div>
          ) : eliminatedTLAs.has(selectedTeam) ? null : !data ? (
            <div className="loading">Loading…</div>
          ) : (() => {
            const teamGroup = Object.entries(data.groupMap).find(([, rows]) =>
              rows.some((r) => r.team.tla === selectedTeam)
            );
            const groupLetter = teamGroup?.[0] ?? "";
            const groupRows = teamGroup?.[1] ?? [];
            const teamInfo = groupRows.find((r) => r.team.tla === selectedTeam)?.team;

            const teamMatches = data.matches.filter(
              (m) => m.homeTeam?.tla === selectedTeam || m.awayTeam?.tla === selectedTeam
            );
            const groupMatches = teamMatches.filter((m) => m.stage === "GROUP_STAGE")
              .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());
            const knockoutMatchesForTeam = teamMatches.filter((m) => m.stage !== "GROUP_STAGE")
              .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

            const teamRow = groupRows.find((r) => r.team.tla === selectedTeam);
            const position = groupRows.findIndex((r) => r.team.tla === selectedTeam) + 1;
            const gamesPlayed = teamRow?.playedGames ?? 0;
            const totalGroupGames = 3;

            function matchResult(m: Match): "win" | "loss" | "draw" | "upcoming" | "live" {
              if (isLive(m.status)) return "live";
              if (!isFinished(m.status)) return "upcoming";
              const isHome = m.homeTeam.tla === selectedTeam;
              const ours = isHome ? (m.score.fullTime.home ?? 0) : (m.score.fullTime.away ?? 0);
              const theirs = isHome ? (m.score.fullTime.away ?? 0) : (m.score.fullTime.home ?? 0);
              if (ours > theirs) return "win";
              if (ours < theirs) return "loss";
              return "draw";
            }

            function scoreClass(result: string) {
              if (result === "win") return "jsc win";
              if (result === "loss") return "jsc loss";
              if (result === "live") return "jsc live";
              return "jsc";
            }

            return (
              <div className="journey">
                <div className="journey-block">
                  <div className="journey-block-head">
                    <h3>Group {groupLetter}</h3>
                    <span className={`stage-badge${position > 2 && gamesPlayed === totalGroupGames ? " eliminated" : ""}`}>
                      {gamesPlayed < totalGroupGames
                        ? `${totalGroupGames - gamesPlayed} game${totalGroupGames - gamesPlayed > 1 ? "s" : ""} remaining`
                        : position <= 2 ? "Qualified" : "Eliminated"}
                    </span>
                  </div>
                  <div className="group-mini">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th><th>Team</th>
                          <th className="c">W</th><th className="c">D</th><th className="c">L</th>
                          <th className="p">Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupRows.map((row, i) => (
                          <tr key={row.team.tla}
                            className={[i < 2 ? "qual" : "", row.team.tla === selectedTeam ? "selected-team" : ""].join(" ").trim()}
                          >
                            <td className="pos">{i + 1}</td>
                            <td><span className="team-name">{row.team.shortName}</span><span className="abbr">{row.team.tla}</span></td>
                            <td className="c">{row.won}</td>
                            <td className="c">{row.draw}</td>
                            <td className="c">{row.lost}</td>
                            <td className="p pts">{row.points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="journey-block">
                  <div className="journey-block-head">
                    <h3>Group Stage Fixtures</h3>
                  </div>
                  <div className="journey-matches">
                    {groupMatches.map((m) => {
                      const isHome = m.homeTeam?.tla === selectedTeam;
                      const finished = isFinished(m.status);
                      const live = isLive(m.status);
                      const result = matchResult(m);
                      const hs = m.score.fullTime.home ?? 0;
                      const as_ = m.score.fullTime.away ?? 0;
                      return (
                        <div className="jmatch" key={m.id}>
                          <div className={`jside${isHome ? " highlight" : ""}`}>
                            {m.homeTeam?.shortName ?? "TBD"}
                            <span className="abbr">{m.homeTeam?.tla}</span>
                          </div>
                          {finished || live ? (
                            <div className={scoreClass(result)}>{hs} – {as_}</div>
                          ) : (
                            <div className="jwhen">{fmtTime(m.utcDate)}<br />{fmtDate(m.utcDate)}</div>
                          )}
                          <div className={`jside away${!isHome ? " highlight" : ""}`}>
                            <span className="abbr">{m.awayTeam?.tla}</span>
                            {m.awayTeam?.shortName ?? "TBD"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {knockoutMatchesForTeam.length > 0 && (
                  <div className="journey-block">
                    <div className="journey-block-head">
                      <h3>Knockout Stage</h3>
                      <span className="stage-badge">In Progress</span>
                    </div>
                    <div className="journey-matches">
                      {knockoutMatchesForTeam.map((m) => {
                        const isHome = m.homeTeam?.tla === selectedTeam;
                        const finished = isFinished(m.status);
                        const live = isLive(m.status);
                        const result = matchResult(m);
                        const hs = m.score.fullTime.home ?? 0;
                        const as_ = m.score.fullTime.away ?? 0;
                        const stageLabel: Record<string, string> = {
                          LAST_32: "Round of 32", LAST_16: "Round of 16",
                          QUARTER_FINALS: "Quarter-final", SEMI_FINALS: "Semi-final", FINAL: "Final",
                        };
                        return (
                          <div className="jmatch" key={m.id}>
                            <div className={`jside${isHome ? " highlight" : ""}`}>
                              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "var(--mut)", marginRight: 6 }}>
                                {stageLabel[m.stage] ?? m.stage}
                              </span>
                              {m.homeTeam?.shortName ?? "TBD"}
                            </div>
                            {finished || live ? (
                              <div className={scoreClass(result)}>{hs} – {as_}</div>
                            ) : (
                              <div className="jwhen">{fmtTime(m.utcDate)}<br />{fmtDate(m.utcDate)}</div>
                            )}
                            <div className={`jside away${!isHome ? " highlight" : ""}`}>
                              {m.awayTeam?.shortName ?? "TBD"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {teamMatches.filter((m) => m.stage !== "GROUP_STAGE").length === 0 && gamesPlayed < totalGroupGames && (
                  <div className="journey-block">
                    <div className="journey-block-head">
                      <h3>Knockout Stage</h3>
                      <span className="stage-badge tbd">TBD</span>
                    </div>
                    <div style={{ padding: "20px 18px", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "var(--mut)", lineHeight: 1.8 }}>
                      {teamInfo?.name ?? selectedTeam} need to finish in the top 2 of Group {groupLetter}, or as one of the 8 best third-placed teams, to reach the Round of 32.
                      <br /><br />
                      Current position: <strong style={{ color: position <= 2 ? "var(--green)" : "var(--txt)" }}>
                        {position}{position === 1 ? "st" : position === 2 ? "nd" : position === 3 ? "rd" : "th"} in Group {groupLetter}
                      </strong>
                    </div>
                  </div>
                )}

                {(() => {
                  const roundInfo: Record<string, { dates: string; venue: string }> = {
                    LAST_32:        { dates: "28 Jun – 3 Jul",  venue: "Various stadiums" },
                    LAST_16:        { dates: "4 – 7 Jul",       venue: "Various stadiums" },
                    QUARTER_FINALS: { dates: "9 – 10 Jul",      venue: "Various stadiums" },
                    SEMI_FINALS:    { dates: "14 – 15 Jul",     venue: "AT&T / MetLife"   },
                    FINAL:          { dates: "19 Jul",           venue: "MetLife Stadium"  },
                  };

                  const stages = [
                    { key: "LAST_32",        short: "R32",   label: "Round of 32"    },
                    { key: "LAST_16",        short: "R16",   label: "Round of 16"    },
                    { key: "QUARTER_FINALS", short: "QF",    label: "Quarter-Final"  },
                    { key: "SEMI_FINALS",    short: "SF",    label: "Semi-Final"     },
                    { key: "FINAL",          short: "FINAL", label: "The Final"      },
                  ] as const;

                  return (
                    <div className="journey-block road-block">
                      <div className="journey-block-head">
                        <h3>Road to the Final</h3>
                        {gamesPlayed < totalGroupGames && (
                          <span className="stage-badge tbd" style={{ fontSize: 10 }}>Based on current standing</span>
                        )}
                      </div>
                      <div className="road-timeline">
                        {stages.map(({ key, short, label }) => {
                          const m = allMatches.find(
                            (x) => x.stage === key &&
                              (x.homeTeam?.tla === selectedTeam || x.awayTeam?.tla === selectedTeam)
                          );
                          const finished = m ? isFinished(m.status) : false;
                          const live     = m ? isLive(m.status) : false;
                          const isHome   = m?.homeTeam?.tla === selectedTeam;
                          const hs = m?.score?.fullTime?.home ?? 0;
                          const as_ = m?.score?.fullTime?.away ?? 0;
                          const ourGoals   = isHome ? hs : as_;
                          const theirGoals = isHome ? as_ : hs;
                          const won  = finished && ourGoals > theirGoals;
                          const lost = finished && ourGoals < theirGoals;
                          const drew = finished && ourGoals === theirGoals;
                          const opponent = m ? (isHome ? m.awayTeam : m.homeTeam) : null;

                          const info = roundInfo[key];
                          const dateStr = m ? fmtDate(m.utcDate) : info.dates;
                          const venueStr = info.venue;

                          let oppLabel = "Opponent TBD";
                          if (opponent?.shortName) oppLabel = `vs ${opponent.shortName} (${opponent.tla})`;
                          else if (m) oppLabel = "vs TBD";

                          let statusLabel = "UPCOMING";
                          let statusCls   = "road-status upcoming";
                          if (live)  { statusLabel = "● LIVE";               statusCls = "road-status live"; }
                          else if (won)  { statusLabel = `WON ${ourGoals}–${theirGoals}`;  statusCls = "road-status win"; }
                          else if (lost) { statusLabel = `LOST ${ourGoals}–${theirGoals}`; statusCls = "road-status loss"; }
                          else if (drew) { statusLabel = `DRAW ${ourGoals}–${theirGoals}`; statusCls = "road-status draw"; }

                          const isFinal = key === "FINAL";

                          return (
                            <div className={`road-step${isFinal ? " final-step" : ""}${lost ? " eliminated-step" : ""}`} key={key}>
                              <div className="road-left">
                                <div className="road-short">{short}</div>
                                <div className="road-meta">{dateStr} · {venueStr}</div>
                              </div>
                              <div className="road-mid">
                                <div className="road-opp">{oppLabel}</div>
                              </div>
                              <div className={statusCls}>{statusLabel}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}
        </div>
      </div>

      <footer>
        <div className="wrap">
          Live data via football-data.org · auto-refreshes every{" "}
          {anyLiveNow ? "30s during live matches" : "60s"} · knockout stage in progress.
          <br />
          A fan-made dashboard · World Cup 2026 · USA / Canada / Mexico
        </div>
      </footer>
    </>
  );
}

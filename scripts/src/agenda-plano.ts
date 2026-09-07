/**
 * One scheduler tick. Decides, from Lisbon's clock, what should run right now.
 *
 * ## Why the decision lives here and not in the cron expression
 *
 * Railway's cron schedules are evaluated in **UTC and only UTC** — there is no
 * timezone field. Portugal is UTC+1 for seven months of the year and UTC+0 for
 * the other five, so any fixed UTC expression is right for one half of the
 * year and an hour wrong for the other. `0 7 * * 1-5` means 08:00 in August
 * and 07:00 in January.
 *
 * For the fifteen-minute refresh that does not matter. For the analysis it
 * does: the whole point of the 08:00 run is that it finishes before people
 * arrive, and the 16:30 run is timed to the end of the working day. Drifting
 * an hour either way in winter defeats both.
 *
 * So Railway fires this script every fifteen minutes and *this* decides, using
 * `Europe/Lisbon` through Intl, which of the two jobs are due. The schedule
 * moves with the clock changes because it is read from tzdata, not from a
 * constant somebody has to remember to edit twice a year.
 *
 * ## The two jobs, and why they run at different rates
 *
 *   `painel/refresh` — no LLM, by construction and by test. Re-syncs the day's
 *      missed calls from Ringover and recent tickets and comments from Desk.
 *      These two feeds are what the panel's evidence check reads, so a reply
 *      sent in Desk at 09:15 only makes the task disappear once this has run.
 *      Hence every fifteen minutes, with a two-hour Desk window so that fifty
 *      runs a day do not cost fifty two-day syncs.
 *
 *   `run` — the analysis. Costs real money per conversation, so exactly twice
 *      a working day: before the team arrives, and once more at the end of the
 *      afternoon.
 *
 * ## Failure posture
 *
 * The refresh failing must not stop the analysis, and vice versa. Each is
 * attempted, each reports, and the exit code is non-zero if any failed — which
 * is what makes a broken schedule visible in Railway rather than silent.
 */

const TZ = "Europe/Lisbon";

/** Lisbon wall-clock now: weekday 0-6 (Sunday = 0), hour, minute. */
export function relogioLisboa(agora: Date): { dia: number; hora: number; minuto: number } {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(agora);
  const ler = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const semana = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    dia: Math.max(0, semana.indexOf(ler("weekday"))),
    // Intl renders midnight as "24" in some locales' 24-hour clock.
    hora: Number(ler("hour")) % 24,
    minuto: Number(ler("minute")),
  };
}

/** Monday to Friday. Saturday has almost no calls and Sunday none at all. */
function diaUtil(dia: number): boolean {
  return dia >= 1 && dia <= 5;
}

/**
 * The analysis slots, in Lisbon wall-clock time.
 *
 * A slot fires on the tick that *contains* it, so the window has to be at
 * least as wide as the cron interval or a slot falls between two ticks and
 * never runs. Fifteen minutes of cron, fifteen minutes of window.
 *
 * ## The days are not "working days", and that distinction has teeth
 *
 * The morning run analyses **yesterday**, so the day it must run on is the day
 * *after* a working day — Tuesday to Saturday. Running it Monday to Friday
 * instead, which is the obvious-looking choice, means Friday's calls are never
 * analysed at all: Friday morning reads Thursday, and Monday morning reads
 * Sunday. A whole working day would vanish every week, and quietly, because an
 * empty Monday looks exactly like a quiet Monday.
 *
 * Saturday's run costs nothing but the container: nobody is in the office, but
 * the panel is ready when they arrive on Monday.
 *
 * The afternoon run reads **today**, which is what makes it worth paying for —
 * it picks up the morning's calls. So it runs on the working days themselves.
 */
export interface SlotDeAnalise {
  hora: number;
  minuto: number;
  /** Which day to analyse: -1 is yesterday, 0 is today. */
  offset: number;
  /** Lisbon weekday numbers, 0 = Sunday. */
  dias: readonly number[];
}

export const SLOTS_ANALISE: readonly SlotDeAnalise[] = [
  // Terça a sábado: o dia anterior foi um dia de trabalho.
  { hora: 8, minuto: 0, offset: -1, dias: [2, 3, 4, 5, 6] },
  // Segunda a sexta: apanha as chamadas da própria manhã.
  { hora: 16, minuto: 30, offset: 0, dias: [1, 2, 3, 4, 5] },
];

/** The hours the refresh is worth running. Nobody is working at 03:00. */
export const HORA_INICIO = 7;
export const HORA_FIM = 20;

export interface Plano {
  refresh: boolean;
  /** The day to analyse, or null when no analysis is due on this tick. */
  analise: number | null;
  porque: string;
}

export function planear(agora: Date, intervaloMin = 15): Plano {
  const { dia, hora, minuto } = relogioLisboa(agora);
  const relogio = `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
  const agoraMin = hora * 60 + minuto;

  // Deliberately not an early return on the weekend: Saturday morning has no
  // refresh and does have the analysis of Friday, and collapsing the two
  // decisions into one "is it a working day" is exactly how Friday got lost.
  const refresh = diaUtil(dia) && hora >= HORA_INICIO && hora < HORA_FIM;

  const slot = SLOTS_ANALISE.find((s) => {
    if (!s.dias.includes(dia)) return false;
    const inicio = s.hora * 60 + s.minuto;
    return agoraMin >= inicio && agoraMin < inicio + intervaloMin;
  });

  return {
    refresh,
    analise: slot ? slot.offset : null,
    porque: `${relogio} em Lisboa`,
  };
}

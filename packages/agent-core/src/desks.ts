export type DeskKind = 'flight' | 'stay';

const FLIGHT = /\b(flights?|fly|flying|airfare|airline)\b/i;
const STAY = /\b(hotels?|stay|staying|rooms?|airbnb|hostel)\b/i;

/** Which desks a traveler message should wake. At most one flight desk and one stay desk. */
export function planAgentDesks(text: string): DeskKind[] {
  const desks: DeskKind[] = [];
  if (FLIGHT.test(text)) desks.push('flight');
  if (STAY.test(text)) desks.push('stay');
  return desks;
}

export function deskName(kind: DeskKind): string {
  return kind === 'flight' ? 'Flight desk' : 'Stay desk';
}

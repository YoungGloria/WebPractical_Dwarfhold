export type DestinationId = "crystal-cave" | "old-mine" | "blocked-pass" | "abandoned-fortifications" ;

export interface ExpeditionDestination {
  id: DestinationId;
  label: string;
  description: string;
  recruitsKnight: boolean;
  attack: boolean;
}

export const destinations: readonly ExpeditionDestination[] = [
  {
    id: "crystal-cave",
    label: "Crystal Cave",
    description: "Rich crystal seams and a chance to meet Sir One Uper.",
    recruitsKnight: true,
    attack: false,
  },
  {
    id: "old-mine",
    label: "The Old Mine",
    description: "An abandoned mine with stone and usable wood.",
    recruitsKnight: false,
    attack: false,
  },
  {
    id: "blocked-pass",
    label: "Blocked Pass",
    description: "A sealed route with a high risk of expedition failure.",
    recruitsKnight: false,
    attack: true,
  },
  {
    id: "abandoned-fortifications",
    label: "Abandoned Fortifications",
    description: "An abandoned fortification protecting the cave.",
    recruitsKnight: false,
    attack: true,
  }
];

export function getDestination(id: string): ExpeditionDestination | undefined {
  return destinations.find((destination) => destination.id === id);
}

export function destinationRecruitsKnight(id: string): boolean {
  return getDestination(id)?.recruitsKnight ?? false;
}

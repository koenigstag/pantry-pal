import type { Household, HouseholdMember, PantryItem, PantryLocation } from '@pantry-pal/shared';

/**
 * Everything a service can announce. The gateway maps each to a socket event
 * and a room; services never touch sockets themselves.
 */
export type DomainChange =
  | { readonly type: 'item.created'; readonly item: PantryItem }
  | { readonly type: 'item.updated'; readonly item: PantryItem }
  | { readonly type: 'item.deleted'; readonly householdId: string; readonly id: string }
  | { readonly type: 'location.created'; readonly location: PantryLocation }
  | { readonly type: 'location.updated'; readonly location: PantryLocation }
  | { readonly type: 'location.deleted'; readonly householdId: string; readonly id: string }
  | {
      readonly type: 'locations.reordered';
      readonly householdId: string;
      readonly locations: PantryLocation[];
    }
  | { readonly type: 'household.updated'; readonly household: Household }
  | { readonly type: 'household.deleted'; readonly householdId: string }
  | { readonly type: 'member.added'; readonly member: HouseholdMember }
  | { readonly type: 'member.updated'; readonly member: HouseholdMember }
  | { readonly type: 'member.removed'; readonly householdId: string; readonly userId: string };

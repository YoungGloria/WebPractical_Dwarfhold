# Dwarfhold – Game Rules and Design Decisions

This document describes the **expected game behavior** per requirement (D1–D7).

## Basics

**Time.** One game day lasts 8 seconds. The clock ticks every second and runs only when the game is not paused. All countdowns (travel, forging) are measured in seconds of this clock and stand still when paused.

**Starting State.** Day 12 · Wood 14 · Stone 9 · Food 18 · Tools 1 · Weapons 0.

| Dwarf | Specialty | Starts as |
|---|---|---|
| Bromli Copperkeg (Hold Warden) | Mining | Mining |
| Yrsa Flintbraid (Trail Scout) | Woodcutting | Woodcutting |
| Dori Ashmantle (Stone Singer) | none (Generalist) | unassigned |

**Resident Status** – determines what a resident is currently allowed to do:

| Status | Meaning | Produces? | Reassignable? | Can forge / travel? |
|---|---|---|---|---|
| `idle` | without job | no | yes | yes |
| `working` | has a job | yes | yes | yes |
| `expedition` | on the road | no | no | no |
| `forging_Tool` / `forging_Weapon` | forging | no | no | no |
| `resting` | recovering until the next day change | no | no | no |

A resident is always in exactly **one** status — never productive and traveling or forging at the same time.

**Chronicle.** Shows the last 8 events with day and tone (green = good, orange = warning).

---

## D1 – Work and Survival

**Work.** Each resident has at most one job. The yield per day is:

| Job | Yield |
|---|---|
| Woodcutting | 3 Wood |
| Mining | 2 Stone |
| Mushroom Farm | 4 Food |
| unassigned | nothing |

An assignment takes effect immediately as a status, but only affects production at the next day change. Anyone traveling, resting, or forging cannot be reassigned.

**Day Change – Order.**
1. Check whether a famine is occurring.
2. Calculate production and meals.
3. Resting residents become available again (with job → `working`, without → `idle`).
4. The day increments by one.

**Meals.** Every resident eats 1 Food per day — including absent ones, resting ones, those forging, and the knight. Food never drops below 0.

**Rest Day.** After an expedition (success or failure) and after forging, the resident rests until the next day change. On that day they produce nothing; starting the day after, they work again.

**Decision: Consequence of a Famine.**

- **When:** When the food stock *at the start of the day change* is smaller than the number of residents. Only the stock counts; daily production from farmers is not included. Food equal to the number of residents is not yet a famine (example: 3 residents, 3 food → no famine; 2 food → famine).
- **Effect:** Every productive resident produces **1 less** of their resource, down to a minimum of 0. This also affects the Mushroom Farm (4 → 3).
- **Stacks with other bonuses:** Tool +1, Knight +1, Famine −1 (for example, a knight with a tool in mining: 2 + 1 + 1 − 1 = 3).
- **No harsh penalties:** Nobody dies or leaves the settlement. Missing food simply disappears (stock stays at 0).
- **Visible:** As long as the condition applies, the interface shows a famine popup ("Your workers output is reduced by 1"). At the day change, a warning also appears in the chronicle. The popup disappears automatically as soon as the stock is sufficient again.
- **Deterministic:** The same state always leads to the same result.

The Colony page displays "Net food after meals" (green when positive, red when negative), including tool, knight, and famine effects.

---

## D2 – Tools, Weapons, Equipment

**Equipping a Tool.** Using the "Has Tool" checkbox, a resident takes a tool from the shared stockpile. Unchecking returns it.
- At most 1 tool per resident; each tool held by at most one resident.
- With no tools in the stockpile, the checkbox is disabled.
- The roster card shows who is carrying a tool.
- Stockpile + carried tools always equal the total number of existing tools.
- There is no durability.

**Bonus.** A carried tool grants **+1** of the assigned resource per day (Woodcutting 3 → 4, Mining 2 → 3, Mushroom Farm 4 → 5). The bonus applies only while the resident is actually producing. Without a job, on an expedition, while forging, or on a rest day, there is no bonus. Specialties have no effect on production.

**Weapons.**
- **Decision – Cost:** 4 Wood + 3 Stone, 7 seconds forge time (tool for comparison: 3 Wood + 2 Stone, 5 seconds).
- Weapons are a **colony resource** ("Weapons" in the resource bar). They are not given to residents and grant no production bonus.
- Weapons are not consumed over the course of a day. Their sole purpose is repelling a raid (see D7).

---

## D3 – Forging as Colony Work

Forging requires **materials, an eligible smith, and time**. There is no instant forging.

- **Materials:** Deducted at *start* (not upon completion). An exact match is enough; one unit less is not. There is no cancellation with a refund.
- **Eligible Smith:** Only a dwarf with a **specialty** who is not currently busy. Generalists (at start: Dori) and the knight cannot forge.
- **While Forging:** The smith is busy: produces nothing, cannot be reassigned, and cannot go on an expedition. They continue to eat. Multiple smiths can work simultaneously.
- **Completion:** The result (+1 tool or +1 weapon in the stockpile) is created once. Afterward, the smith rests until the next day change.
- **Invalid Attempt** (missing materials, smith unsuitable or busy): Nothing changes — neither materials, nor residents, nor the chronicle. The Forge button is disabled until a specialist is selected and materials are sufficient.
- **Visible:** The Forge page shows "Ready in: N s – Name is crafting". The chronicle names the smith at start and completion. The footer shows "Forge: burning" while someone is forging.

---

## D4 – Resilient Expeditions

**Who Can Travel:** Any resident who is not currently busy (even without a job). Not the knight.

**Expedition Flow (Two Phases).**
1. **Travel:** 5-second countdown. The dwarf is `expedition`: produces nothing, cannot be reassigned, cannot forge, continues to eat. Everyone else continues working normally.
2. **Request:** After the countdown, the request goes to the server (standard response time 2 seconds). The dwarf remains away until the response arrives.

A dwarf can only have one expedition at a time. A second click is ignored.

**Success.** Rewards are credited **once**. The dwarf returns and rests until the next day change. The chronicle reports the find. A duplicate delivery of a success message has no effect.

**Failure.** No reward. The dwarf is not permanently gone; they return and also rest until the next day change. The chronicle shows the server message as a warning.

**Retries on Network Issues.** Network errors and timeouts (10 seconds) are retried up to 2 times (after 0.5 s and 1 s). The request ID stays the same, so the server re-delivers the same expedition rather than rewarding a new one. Domain errors (rockslide, unknown destination) are not retried. A request ID used for a different destination or a different dwarf is rejected.

**Decision – Tools on Travels:** A carried tool **stays with the traveling dwarf**. It is not returned to the stockpile and not given to anyone else. There is no bonus while traveling. The total number of tools remains consistent in every case, even on failure.

**Destinations.**

| Destination | Outcome |
|---|---|
| Crystal Cave | 8 Stone + 1 Tool · brings the knight (D6) |
| The Old Mine | 12 Stone + 2 Wood |
| Blocked Pass | always fails (rockslide) |
| Abandoned Fortifications | 4 Stone + 3 Wood + 1 Tool + 1 Weapon · triggers a raid (D7) |

---

## D5 – Saving and Restoring

**What Is Saved:** Day, resources, all residents (status, job, tool, remaining time), chronicle, "knight has joined" flag, elapsed time of the current day, and open expedition requests.

**When:** Automatically after every change and every second. A new save is created for each completed day. The last 5 saves are kept. Unchanged states are not saved twice.

**After Reloading:**
- The game starts **paused** ("Wake the hold"). A popup explains what happened.
- Latest save readable → "Latest save restored – No progress was lost".
- Latest save corrupted, older one readable → "Older save restored – Some progress was lost".
- Nothing readable → new colony (paused) with "Saved hold lost". The popup distinguishes "Save file corrupted" from "Save file is from a different version".
- Invalid values (negative or fractional resources, unknown statuses, duplicate IDs, wrong version) count as corrupted or incompatible. The game never crashes. Old saves without a species count as a dwarf; without a knight flag, as "not joined".

**Decision – Interrupted Tasks:**

| Task on Reload | Behavior |
|---|---|
| Forging | continues after waking up with remaining time |
| Expedition with saved request | continues with remaining time; request is re-sent with the same ID |
| Expedition without saved request | treated as lost: dwarf rests, no reward, warning "lost its trail during the reload" |

Every interrupted task is mentioned in the chronicle.

**Not Saved:** Popup messages (e.g., the raid popup) and the pause state. However, the event itself remains in the chronicle as long as it is among the last 8 entries. 
---

## D6 – A New Species: Sir One Uper (Knight)

**Identity.** A knight with 🤴, title "Produces 1 extra". The roster card displays "Knight (+1 basic yield)" instead of a specialty or "Generalist".

**Joining.**
- Arrives after the **first successful expedition to Crystal Cave**. Failures do not count, nor do other destinations.
- Arrives **once**, not a second time even after reloading.
- Arrives idle, without a job and without a tool.
- Joining is deterministic. Even though the destination description mentions a "chance," it happens on the first success.
- There is no dedicated chronicle or popup message. You first see him in the roster.

**Special Trait – Production.** He grants **+1 on every job** (Woodcutting 4, Mining 3, Mushroom Farm 5). This stacks with tools and famine. That makes him the strongest worker in the colony; a knight on the Mushroom Farm yields a net 4 food after his own meal.

**Special Trait – Restriction.** He can **neither forge nor go on an expedition**. He has no specialty and does not appear in selection lists for smith or scout.

**How He Fits Into the Rules.** He eats 1 Food per day and counts toward the famine check. He has exactly one job at a time, can be reassigned or set to "unassigned," and rests after busy days. He can carry a tool from the stockpile. He is saved and restored along with everything else.

---

## D7 – Consequences of Expeditions and Defense

**The Destination.** "Abandoned Fortifications" rewards (4 Stone, 3 Wood, 1 Tool, 1 Weapon). However, the scout is **tracked**: after returning, an enemy attacks the colony.

**When Does the Raid Happen?**
- **Only after a successful completion** of the expedition — **once** per expedition.
- **Never on failure.** Even "Blocked Pass" (which always fails) never triggers a raid. The same applies to forced server errors.
- **Never on duplicate delivery** of the same success message.
- Crystal Cave and Old Mine do not trigger a raid.

**Order of Events.** First, rewards are credited, the dwarf rests, and the chronicle reports the find. **After that**, the enemy attacks. Two consequences follow from this:
1. The weapon just found **counts toward defense**.
2. The raw materials just found **can be looted as well**.

**Decision – Weapon Threshold: 3 Weapons.**

| Weapons in Stockpile (incl. found) | Result |
|---|---|
| 3 or more | The colony repels the attack |
| 0 to 2 | The enemies loot |

**Decision – Defense Consumes Weapons.** On a successful defense, exactly **3 weapons are consumed** ("too dull to use again"). Excess weapons remain (for example, 4 → 1, 7 → 4). Nothing is looted.

**Decision – Looting (Deterministic, No Randomness).** With too few weapons:
- **All weapons are lost** (even 1 or 2; they weren't enough).
- **Wood, Stone, Food, and Tools in the stockpile are halved.** Rounded to the nearest whole number, with .5 rounded up. So the colony keeps the larger half (9 → 5, 1 → 1, 0 → 0).
- Carried tools, all residents, the knight, and the day remain untouched.

The same state always leads to the same result.

**Visibility.**

| Location | Defense | Looting |
|---|---|---|
| Popup (with Close button) | "The Raid was defeated!" · weapons are consumed | "You have been raided!" · half of the resources were stolen; text states whether no weapons were available or they were insufficient |
| Chronicle | green entry | warning entry |
| Resource bar | weapons reduced | weapons set to 0, remaining resources halved |

Both popups say: "They appear to have followed your scout."

**Planning Rule for Players.** Because the found weapon counts, **2 weapons in the stockpile** before the expedition are enough (3 in total). Two weapons cost 8 Wood + 6 Stone and 7 seconds of forge time each. After repelling the raid, the 3 weapons are consumed. Every further expedition to the Fortifications brings another +1 weapon, but also triggers another raid, so supplies must be rebuilt again.
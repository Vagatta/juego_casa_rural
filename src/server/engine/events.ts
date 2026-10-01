import { LIGHTNING_TAG } from '../../shared/constants.ts';
import { gameContent, type EventDef } from '../content.ts';
import { deliverClue, randomClue } from './clues.ts';
import { assignMission } from './missions.ts';
import { chance, pick, sample } from './rng.ts';
import { type Game, type Outbox, activePlayers, announce, currentPlan, earn, isCuco, nameOf, toast } from './state.ts';

const EVENT_CHANCE = { clasico: 0.5, caos: 0.9, sofa: 0.45 } as const;

export function eligibleEvents(g: Game): EventDef[] {
  const plan = currentPlan(g);
  return gameContent(g).events.filter(
    (e) =>
      !g.used.events.includes(e.id) &&
      (!e.modes || e.modes.includes(g.settings.mode)) &&
      (e.minRound ?? 2) <= g.roundIndex + 1 &&
      (!e.requiresJudgment || plan?.hasJudgment) &&
      !(e.effect.type === 'cuco_mission' && g.cucoCount === 0),
  );
}

/** ¿Toca evento al empezar esta ronda? */
export function rollRoundEvent(g: Game): EventDef | null {
  if (g.roundIndex < 1 || !chance(EVENT_CHANCE[g.settings.mode])) return null;
  const pool = eligibleEvents(g);
  return pool.length ? pick(pool) : null;
}

export function applyEvent(g: Game, eventId: string, out: Outbox): void {
  const def = gameContent(g).eventById.get(eventId);
  if (!def) throw new Error(`Evento desconocido ${eventId}`);
  g.used.events.push(def.id);
  const now = Date.now();
  const effect = def.effect;
  g.event = { id: def.id, endsAt: effect.type === 'rule' || effect.type === 'lightning' || effect.type === 'auction' || effect.type === 'truce' ? now + effect.durationSec * 1000 : null };
  g.rounds[g.roundIndex]?.eventIds.push(def.id);
  const active = activePlayers(g);
  const byCoins = () => [...active].sort((a, b) => b.coins - a.coins);

  switch (effect.type) {
    case 'rule':
      break;
    case 'coins_multiplier':
      g.flags.multiplier = effect.factor;
      break;
    case 'coin_gift':
      active.forEach((p) => earn(g, p, effect.amount, false));
      break;
    case 'tax':
      for (const p of byCoins().slice(0, 3)) {
        const paid = Math.floor((p.coins * effect.percent) / 100);
        p.coins -= paid;
        if (paid) toast(out, p.id, { text: `Hacienda rural te cobra ${paid} 🪙`, tone: 'danger', sound: 'danger' });
      }
      break;
    case 'robin_hood': {
      const sorted = byCoins();
      const poorest = sorted[sorted.length - 1];
      const richest = sorted[0];
      if (!poorest) break;
      if (effect.fromHouse) earn(g, poorest, effect.amount, false);
      else if (richest && richest.id !== poorest.id) {
        const moved = Math.min(effect.amount, richest.coins);
        richest.coins -= moved;
        poorest.coins += moved;
        announce(g, `${richest.name} le da ${moved} 🪙 a ${poorest.name}.`, 'info');
      }
      break;
    }
    case 'shop_sale':
      g.flags.shopSale = true;
      break;
    case 'no_shop':
      g.flags.noShop = true;
      break;
    case 'mission_wave':
      active.forEach((p) => assignMission(g, p, out));
      break;
    case 'lightning':
      // Una misión cronometrada para cada uno: se apaga cuando cae el banner
      for (const p of active) {
        const m = assignMission(g, p, out);
        if (m) {
          m.expiresAt = now + effect.durationSec * 1000;
          if (!m.tags.includes(LIGHTNING_TAG)) m.tags.push(LIGHTNING_TAG);
        }
      }
      break;
    case 'secret_intel':
      for (const p of sample(active, Math.min(active.length, effect.count ?? 1))) deliverClue(g, out, p, 'nota', randomClue(g, p, 'true'));
      break;
    case 'snitch': {
      // El chivato: uno recibe una pista verdadera y OTRO sabe que él la recibió.
      // Nadie tiene la información completa — paranoia garantizada.
      const [recipient, witness] = sample(active, 2);
      if (recipient) {
        deliverClue(g, out, recipient, 'nota', randomClue(g, recipient, 'true'));
        toast(out, recipient.id, { text: '🐀 El chivato de la casa te ha contado algo. Es verdad.', tone: 'special', private: true });
      }
      if (witness) {
        deliverClue(g, out, witness, 'chisme', { text: `Viste al chivato de la casa susurrarle algo a ${recipient!.name}. Fuera lo que fuera, era verdad.`, truth: 'true' });
      }
      break;
    }
    case 'inheritance': {
      // La herencia del casero: el más rico cede un porcentaje de su fortuna al más pobre
      const sorted = byCoins();
      const richest = sorted[0];
      const poorest = sorted[sorted.length - 1];
      if (richest && poorest && richest.id !== poorest.id && richest.coins > 0) {
        const cut = Math.floor((richest.coins * effect.percent) / 100);
        richest.coins -= cut;
        poorest.coins += cut;
        announce(g, `🧓 ${richest.name} hereda... a la fuerza: le cede ${cut} 🪙 a ${poorest.name}.`, 'special');
        toast(out, richest.id, { text: `La herencia del casero: -${cut} 🪙`, tone: 'danger', sound: 'danger' });
        toast(out, poorest.id, { text: `Te ha tocado la herencia del casero · +${cut} 🪙`, tone: 'coins', sound: 'coins' });
      }
      break;
    }
    case 'laden_vote':
      // Voto lastrado: el condenado del juicio anterior vota con el peso de la rabia
      g.flags.ladenVote = true;
      if (g.condemned.length) announce(g, `⚖️ ${g.condemned.map((id) => nameOf(g, id)).join(' y ')} ${g.condemned.length === 1 ? 'vota' : 'votan'} con el peso de la rabia: su voto contará doble.`, 'special');
      break;
    case 'truce':
      // La sobremesa: ni ¡PILLADO! ni doble o nada hasta que acabe la tregua
      g.truceUntil = now + effect.durationSec * 1000;
      break;
    case 'cuco_mission':
      active.filter(isCuco).forEach((p) => assignMission(g, p, out, 'cuco'));
      break;
    case 'extra_cerilla':
      active.filter(isCuco).forEach((p) => {
        p.cerillas++;
        toast(out, p.id, { text: 'Tienes una cerilla más 🔥', tone: 'special', private: true, sound: 'mission' });
      });
      break;
    case 'public_vote':
      g.flags.publicVote = true;
      break;
    case 'auction':
      // Subasta ciega: pujas selladas; solo paga el ganador. La TV cuenta atrás.
      g.auction = { endsAt: now + effect.durationSec * 1000, bids: {} };
      break;
  }
  announce(g, `${def.emoji} ${def.title}`, 'special');
  toast(out, 'all', { text: `${def.emoji} EVENTO · ${def.title}`, tone: 'special', sound: 'danger' });
}

/** Cierra la subasta del casero: la puja más alta se lleva una pista que siempre
 *  dice la verdad. El precio es público; quién pagó, jamás. */
export function resolveAuction(g: Game, out: Outbox): void {
  const auction = g.auction;
  if (!auction) return;
  g.auction = null;
  if (g.event) g.event = { ...g.event, endsAt: null };
  const bids = Object.entries(auction.bids)
    .map(([playerId, b]) => ({ playerId, amount: b.amount, at: b.at }))
    .sort((a, b) => b.amount - a.amount || a.at - b.at); // empate: puja antes, gana antes
  for (const top of bids) {
    const winner = g.players.find((p) => p.id === top.playerId && !p.left);
    if (!winner || winner.coins < top.amount) continue; // ya no le llega: pasa al siguiente
    winner.coins -= top.amount;
    winner.stats.coinsSpent += top.amount;
    deliverClue(g, out, winner, 'despensa', randomClue(g, winner, 'true'));
    toast(out, winner.id, { text: `🏷️ El sobre del casero es tuyo · -${top.amount} 🪙`, tone: 'special', private: true, sound: 'coins' });
    announce(g, `🏷️ El sobre del casero se ha vendido por ${top.amount} 🪙. Nadie sabe quién lo compró.`, 'special');
    toast(out, 'all', { text: `🏷️ El sobre se vendió por ${top.amount} 🪙. ¿Quién lo tiene?`, tone: 'coins' });
    return;
  }
  announce(g, '🏷️ Nadie pujó por el sobre del casero. Se pudre en el cajón.', 'info');
}

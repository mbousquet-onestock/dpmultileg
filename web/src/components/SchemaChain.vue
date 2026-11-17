<script setup lang="ts">
/**
 * Draws one logistic chain: origin -> [leg] -> hub/zone -> [leg] -> ... -> destination.
 */
import { OsBadge, OsIcon, OsPicto, OsTooltip } from '@onestock-public/design-system';
import { formatHours, zoneEndpoints } from '@shared/logistics';
import type { DeliveryRoute, Destination, Endpoint, PromiseRoute } from '@shared/types';
import { computed } from 'vue';
import { countryName, formatDate, t } from '../i18n';
import { endpoints, zoneCtx } from '../store';

export interface ChainLeg {
  route?: DeliveryRoute;
  promise?: PromiseRoute;
  configCarrier?: boolean;
}

const props = defineProps<{ legs: ChainLeg[]; destination: Destination; highlight?: boolean; compact?: boolean }>();

interface Node {
  key: string;
  icon: string;
  title: string;
  subtitle?: string;
  endpoints: Endpoint[];
  highlighted?: string;
  kind: 'origin' | 'hop' | 'destination';
}

function iconFor(eps: Endpoint[]): string {
  const cls = eps.flatMap((e) => (Array.isArray(e.classification) ? e.classification : Object.keys(e.classification ?? {}))).join(' ').toLowerCase();
  const name = eps.map((e) => `${e.id} ${e.name ?? ''}`).join(' ').toLowerCase();
  if (/warehouse|entrep|dc\b|wh/.test(cls + name)) return 'warehouse';
  if (/hub|platform|plateforme/.test(cls + name)) return 'hub';
  if (/store|magasin|shop|boutique/.test(cls + name)) return 'store';
  return 'place';
}

function zoneNode(zoneId: string | undefined, kind: Node['kind'], key: string, highlighted?: string): Node {
  const zone = zoneId ? zoneCtx.value.zones.get(zoneId) : undefined;
  const eps = zoneEndpoints(zone, zoneCtx.value);
  return {
    key,
    kind,
    icon: eps.length ? iconFor(highlighted ? eps.filter((e) => e.id === highlighted) : eps) : 'earth',
    title: zone?.name ?? zoneId ?? '?',
    subtitle: zone?.name ? zoneId : undefined,
    endpoints: eps,
    highlighted,
  };
}

const destNode = computed<Node>(() => {
  const d = props.destination;
  const lastZone = props.legs[props.legs.length - 1]?.route?.destination_zone_id;
  const zone = lastZone ? zoneCtx.value.zones.get(lastZone) : undefined;
  if (d.endpoint_id) {
    const ep = endpoints.value.find((e) => e.id === d.endpoint_id);
    return { key: 'dest', kind: 'destination', icon: 'store', title: ep?.name ?? d.endpoint_id, subtitle: zone?.name ?? lastZone, endpoints: [] };
  }
  if (d.delivery_zone) {
    const z = zoneCtx.value.zones.get(d.delivery_zone);
    return { key: 'dest', kind: 'destination', icon: 'place', title: z?.name ?? d.delivery_zone, subtitle: t('customer'), endpoints: [] };
  }
  const l = d.location ?? {};
  const where = [l.zip_code, l.state, l.country ? countryName(l.country) : undefined].filter(Boolean).join(' · ');
  return { key: 'dest', kind: 'destination', icon: 'place', title: `${t('customer')} – ${where}`, subtitle: zone?.name ?? lastZone, endpoints: [] };
});

const nodes = computed<Node[]>(() => {
  const list: Node[] = [];
  props.legs.forEach((leg, i) => {
    const originEndpoint = leg.promise?.origin_endpoint_id ?? leg.promise?.endpoint_id;
    if (i === 0) list.push(zoneNode(leg.route?.origin_zone_id, 'origin', 'o', originEndpoint));
    else {
      // Arrival zone of the previous leg and departure zone of this one may differ (they share stock locations).
      const prevDest = props.legs[i - 1].route?.destination_zone_id;
      const node = zoneNode(prevDest ?? leg.route?.origin_zone_id, 'hop', `h${i}`);
      const origin = leg.route?.origin_zone_id;
      if (origin && prevDest && origin !== prevDest) {
        const oz = zoneCtx.value.zones.get(origin);
        node.subtitle = `→ ${oz?.name ?? origin}`;
      }
      list.push(node);
    }
  });
  list.push(destNode.value);
  return list;
});

const units = computed(() => ({ hour: t('hour'), day: t('day') }));

function carrierText(leg: ChainLeg) {
  const c = leg.route?.carrier ?? leg.promise?.carrier;
  return c ? [c.name, c.option].filter(Boolean).join(' · ') : '?';
}
</script>

<template>
  <div class="chain" :class="{ highlight, compact }">
    <template v-for="(node, i) in nodes" :key="node.key">
      <div class="node" :class="node.kind">
        <OsPicto :icon="node.icon" :size="compact ? 's' : 'm'" :color="node.kind === 'destination' ? 'blue' : node.kind === 'origin' ? 'primary' : 'purple'" />
        <div class="node-texts">
          <span class="os-body-m kind">{{ node.kind === 'origin' ? t('origin') : node.kind === 'destination' ? t('destination') : `${t('leg')} ${i}` }}</span>
          <span class="os-label-l node-title" :title="node.title">{{ node.title }}</span>
          <span v-if="node.subtitle && !compact" class="os-body-s os-text-secondary">{{ node.subtitle }}</span>
          <div v-if="node.endpoints.length && !compact" class="eps">
            <span
              v-for="ep in node.endpoints.slice(0, 4)"
              :key="ep.id"
              class="ep os-body-s"
              :class="{ active: node.highlighted === ep.id, dim: node.highlighted && node.highlighted !== ep.id }"
              :title="ep.id"
              >{{ ep.name ?? ep.id }}</span
            >
            <OsTooltip v-if="node.endpoints.length > 4" :text="node.endpoints.slice(4).map((e) => e.name ?? e.id).join(', ')">
              <span class="ep os-body-s">+{{ node.endpoints.length - 4 }}</span>
            </OsTooltip>
          </div>
        </div>
      </div>
      <div v-if="i < legs.length" class="edge" :class="{ upstream: legs[i].configCarrier === false }">
        <div class="line"><span class="truck"><OsIcon icon="truck" size="s" /></span></div>
        <div class="edge-info">
          <OsBadge :text="carrierText(legs[i])" :color="legs[i].configCarrier === false ? 'grey' : 'primary'" type="secondary" />
          <span v-if="legs[i].route" class="os-body-s os-text-secondary">
            {{ t('transit') }} {{ formatHours(legs[i].route!.minimum_transit_hours, legs[i].route!.maximum_transit_hours, units) }}
          </span>
          <span v-if="legs[i].promise?.eta_end && !compact" class="os-body-s os-text-secondary">≤ {{ formatDate(legs[i].promise!.eta_end) }}</span>
          <span v-if="legs[i].route && !compact" class="os-body-xs os-text-secondary route-id">{{ legs[i].route!.id }}</span>
          <span v-if="legs[i].configCarrier === false && !compact" class="os-body-xs os-text-secondary">{{ t('upstreamLeg') }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.chain { display: flex; align-items: flex-start; gap: 0; overflow-x: auto; padding: 4px 2px 8px; }
.node { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; width: 140px; flex: none; }
.compact .node { width: 120px; gap: 4px; }
.node-texts { display: flex; flex-direction: column; align-items: center; gap: 2px; max-width: 100%; }
.node-title { color: var(--os-text-primary); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.compact .node-title { font-size: 13px; }
.kind { text-transform: uppercase; letter-spacing: 0.04em; color: var(--os-text-secondary); font-size: 10px; }
.eps { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; margin-top: 4px; }
.ep { padding: 2px 6px; border-radius: 3px; background: var(--os-neutral-50); color: var(--os-neutral-700); max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ep.active { background: var(--os-primary-1000); color: #fff; font-weight: 500; }
.ep.dim { opacity: 0.55; }
.edge { flex: 1; min-width: 120px; display: flex; flex-direction: column; align-items: center; gap: 6px; padding-top: 14px; }
.compact .edge { min-width: 110px; padding-top: 6px; }
.line { position: relative; width: 100%; height: 20px; display: flex; align-items: center; justify-content: center; color: var(--os-primary-1000); }
.line::before { content: ''; position: absolute; left: 4px; right: 10px; top: 50%; border-top: 2px solid var(--os-primary-800); }
.line::after { content: ''; position: absolute; right: 4px; top: calc(50% - 5px); border: 5px solid transparent; border-left: 7px solid var(--os-primary-800); }
.truck { position: relative; display: flex; padding: 0 6px; background: var(--chain-bg, #fff); }
.upstream .line { color: var(--os-neutral-500); }
.upstream .line::before { border-top: 2px dashed var(--os-neutral-300); }
.upstream .line::after { border-left-color: var(--os-neutral-300); }
.edge-info { display: flex; flex-direction: column; align-items: center; gap: 3px; text-align: center; }
.route-id { font-size: 10px; }
</style>

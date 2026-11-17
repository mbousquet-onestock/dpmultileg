/** Subset of the OneStock delivery promise referential used by the extension. */

export interface Carrier {
  name: string;
  option: string;
}

export interface Zone {
  id: string;
  name?: string;
  comment?: string;
  country_codes?: string[];
  regions?: string[];
  zip_code?: string;
  excluded_zip_code?: string;
  timezones?: string[];
  included_zones?: string[];
  excluded_zones?: string[];
  included_endpoint_ids?: string[];
  excluded_endpoint_ids?: string[];
  type?: string;
}

export interface DeliveryRoute {
  id: string;
  carrier: Carrier;
  origin_zone_id?: string;
  destination_zone_id?: string;
  minimum_transit_hours?: number;
  maximum_transit_hours?: number;
  delivery_timetable_id?: string;
  opening_timetable_id?: string;
  pickup_timetable_id?: string;
  metric_values?: Record<string, number>;
  information?: Record<string, unknown>;
  carrier_information?: Record<string, unknown>;
  constraints?: unknown;
}

export interface DeliveryConfig {
  id: string;
  name?: string;
  type?: string;
  delivery_method: string;
  sales_channel_id?: string;
  carriers?: Carrier[];
  delivery_zone_ids?: string[];
  authorized_shipment_number?: number;
  stock_request?: string;
  operations?: Record<string, string[]>;
  global_execution_times?: Record<string, string>;
  applied_restrictions?: string[];
}

export interface Endpoint {
  id: string;
  name?: string;
  classification?: string[] | Record<string, unknown>;
  address?: {
    city?: string;
    zip_code?: string;
    lines?: string[];
    regions?: {
      country?: { code?: string; name?: string };
      state?: { code?: string; name?: string };
    };
  };
  timezone?: string;
}

export interface Location {
  country?: string;
  state?: string;
  zip_code?: string;
  timezone?: string;
}

export interface Destination {
  location?: Location;
  delivery_zone?: string;
  endpoint_id?: string;
}

export interface LineItem {
  item_id: string;
  qty: number;
}

export type PromiseStatus = 'valid' | 'valid_estimation' | 'partial' | 'partial_estimation' | 'none';

export interface PromiseRoute {
  id?: string;
  carrier?: Carrier;
  information?: Record<string, unknown>;
  items?: { id: string; quantity: number | string }[];
  eta_start?: number;
  eta_end?: number;
  metric_values?: Record<string, number>;
  /** Some versions return the leg zones directly. */
  origin_zone_id?: string;
  destination_zone_id?: string;
  /** Some versions return the shipping endpoint. */
  endpoint_id?: string;
  origin_endpoint_id?: string;
}

export interface PromiseOption {
  delivery_method: string;
  destination?: Destination;
  status: PromiseStatus;
  reason?: string;
  eta_start?: number;
  eta_end?: number;
  cutoff?: number;
  cost?: number;
  carbon_footprint?: number;
  shipment_number?: number;
  line_items?: LineItem[];
  excluded_line_items?: LineItem[];
  delivery_routes?: PromiseRoute[];
  metric_values?: Record<string, number>;
}

export interface Item {
  id: string;
  product_id?: string;
  name?: string;
  image?: string;
  price?: number | string;
  features?: Record<string, Record<string, unknown[]>>;
}

export interface SalesChannel {
  id: string;
  name?: string;
  currency?: string;
  timezone?: string;
}

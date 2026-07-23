export interface Coordinates {
  lat: number;
  lng: number;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
  placeId?: string;
}

export interface DirectionsResult {
  distanceKm: number;
  durationMin: number;
  polylinePath: string; // encoded polyline
}

export interface IMapProvider {
  geocode(address: string): Promise<GeocodeResult | null>;
  reverseGeocode(lat: number, lng: number): Promise<GeocodeResult | null>;
  getDirections(origin: Coordinates, destination: Coordinates): Promise<DirectionsResult | null>;
  getAutocomplete(input: string, sessionToken?: string): Promise<any[]>;
  getPlaceDetails(placeId: string, sessionToken?: string): Promise<GeocodeResult | null>;
}

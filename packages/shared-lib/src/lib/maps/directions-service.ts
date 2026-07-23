import { mapsService } from './maps-service';
import { Coordinates, DirectionsResult, GeocodeResult } from './map-provider';

export async function getDirections(origin: Coordinates, destination: Coordinates): Promise<DirectionsResult | null> {
  return mapsService.getProvider().getDirections(origin, destination);
}

export async function getAutocompleteSuggestions(input: string): Promise<any[]> {
  return mapsService.getProvider().getAutocomplete(input);
}

export async function getPlaceDetails(placeId: string): Promise<GeocodeResult | null> {
  return mapsService.getProvider().getPlaceDetails(placeId);
}

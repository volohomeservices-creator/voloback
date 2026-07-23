import { mapsService } from './maps-service';
import { GeocodeResult } from './map-provider';

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  return mapsService.getProvider().geocode(address);
}

export async function reverseGeocodeCoordinates(lat: number, lng: number): Promise<GeocodeResult | null> {
  return mapsService.getProvider().reverseGeocode(lat, lng);
}

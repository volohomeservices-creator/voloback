import axios from 'axios';
import { IMapProvider, Coordinates, GeocodeResult, DirectionsResult } from './map-provider';

export class GoogleMapsProvider implements IMapProvider {
  private getApiKey(): string {
    const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || '';
    if (!key) {
      console.warn('[GoogleMapsProvider] Warning: GOOGLE_MAPS_API_KEY is not configured in environment variables.');
    }
    return key;
  }

  async geocode(address: string): Promise<GeocodeResult | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;

    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: {
          address,
          key: apiKey,
        },
      });

      if (response.data.status === 'OK' && response.data.results.length > 0) {
        const result = response.data.results[0];
        return {
          lat: result.geometry.location.lat,
          lng: result.geometry.location.lng,
          formattedAddress: result.formatted_address,
          placeId: result.place_id,
        };
      }
      console.error('[GoogleMapsProvider] Geocode API error:', response.data.status, response.data.error_message || '');
      return null;
    } catch (error: any) {
      console.error('[GoogleMapsProvider] Geocode exception:', error.message || error);
      return null;
    }
  }

  async reverseGeocode(lat: number, lng: number): Promise<GeocodeResult | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;

    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: {
          latlng: `${lat},${lng}`,
          key: apiKey,
        },
      });

      if (response.data.status === 'OK' && response.data.results.length > 0) {
        const result = response.data.results[0];
        return {
          lat,
          lng,
          formattedAddress: result.formatted_address,
          placeId: result.place_id,
        };
      }
      console.error('[GoogleMapsProvider] Reverse Geocode API error:', response.data.status, response.data.error_message || '');
      return null;
    } catch (error: any) {
      console.error('[GoogleMapsProvider] Reverse Geocode exception:', error.message || error);
      return null;
    }
  }

  async getDirections(origin: Coordinates, destination: Coordinates): Promise<DirectionsResult | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;

    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/directions/json', {
        params: {
          origin: `${origin.lat},${origin.lng}`,
          destination: `${destination.lat},${destination.lng}`,
          mode: 'driving',
          key: apiKey,
        },
      });

      if (response.data.status === 'OK' && response.data.routes.length > 0) {
        const route = response.data.routes[0];
        const leg = route.legs[0];
        return {
          distanceKm: Number((leg.distance.value / 1000).toFixed(2)),
          durationMin: Math.ceil(leg.duration.value / 60),
          polylinePath: route.overview_polyline.points,
        };
      }
      console.error('[GoogleMapsProvider] Directions API error:', response.data.status, response.data.error_message || '');
      return null;
    } catch (error: any) {
      console.error('[GoogleMapsProvider] Directions exception:', error.message || error);
      return null;
    }
  }

  async getAutocomplete(input: string, sessionToken?: string): Promise<any[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) return [];

    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/place/autocomplete/json', {
        params: {
          input,
          key: apiKey,
          ...(sessionToken ? { sessiontoken: sessionToken } : {}),
        },
      });

      if (response.data.status === 'OK') {
        return response.data.predictions.map((p: any) => ({
          placeId: p.place_id,
          description: p.description,
          mainText: p.structured_formatting?.main_text || '',
          secondaryText: p.structured_formatting?.secondary_text || '',
        }));
      }
      console.error('[GoogleMapsProvider] Autocomplete API error:', response.data.status, response.data.error_message || '');
      return [];
    } catch (error: any) {
      console.error('[GoogleMapsProvider] Autocomplete exception:', error.message || error);
      return [];
    }
  }

  async getPlaceDetails(placeId: string, sessionToken?: string): Promise<GeocodeResult | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;

    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
        params: {
          place_id: placeId,
          fields: 'geometry,formatted_address,place_id',
          key: apiKey,
          ...(sessionToken ? { sessiontoken: sessionToken } : {}),
        },
      });

      if (response.data.status === 'OK' && response.data.result) {
        const result = response.data.result;
        return {
          lat: result.geometry.location.lat,
          lng: result.geometry.location.lng,
          formattedAddress: result.formatted_address,
          placeId: result.place_id,
        };
      }
      console.error('[GoogleMapsProvider] Place Details API error:', response.data.status, response.data.error_message || '');
      return null;
    } catch (error: any) {
      console.error('[GoogleMapsProvider] Place Details exception:', error.message || error);
      return null;
    }
  }
}

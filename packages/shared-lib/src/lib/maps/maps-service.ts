import { IMapProvider } from './map-provider';
import { GoogleMapsProvider } from './google-maps-provider';

class MapsService {
  private provider: IMapProvider;

  constructor() {
    // Currently default to Google Maps Provider.
    // Can support dynamic provider selection based on settings in future.
    this.provider = new GoogleMapsProvider();
  }

  getProvider(): IMapProvider {
    return this.provider;
  }
}

export const mapsService = new MapsService();

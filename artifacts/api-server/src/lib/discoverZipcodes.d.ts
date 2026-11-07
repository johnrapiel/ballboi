// Types for the `zipcodes` package (BSD, free, bundled data): US ZIP centers
// with their town. Only the call Discover uses.
declare module "zipcodes" {
  export interface ZipInfo {
    zip: string;
    latitude: number;
    longitude: number;
    city: string;
    state: string;
    country: string;
  }
  export function lookup(zip: string | number): ZipInfo | undefined;
  const zipcodes: { lookup: typeof lookup };
  export default zipcodes;
}

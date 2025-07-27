import 'dotenv/config';
import * as fs from 'node:fs/promises';
import util from 'node:util';
import OnebusawaySDK from 'onebusaway-sdk';
import fetch from 'node-fetch';

interface MyStop {
  id: string,
  name: string,
  code?: string,
  direction?: string,
  group?: string, 
}

type OBAStopGroup = OnebusawaySDK.StopsForRouteListResponse.Data.Entry.StopGrouping;

interface OBAStopGrouping {
  stopGroups?: OBAStopGroup[],
}

type OBAListResponseV1 = 
  | OnebusawaySDK.RoutesForAgency.RoutesForAgencyListResponse
  | OnebusawaySDK.AgenciesWithCoverage.AgenciesWithCoverageListResponse;

type OBAListResponseV2 = 
  | OnebusawaySDK.StopsForRoute.StopsForRouteListResponse;

const inspect = (obj: unknown) => {
  return util.inspect(obj, {
    colors: true,
    depth: 10,
    maxArrayLength: 10,
    sorted: true,
    breakLength: 140,
  })
};

const generateLogFilename = () => {
  const date = new Date();
  const timestamp = date.toISOString().replace(/:/g, '-').replace(/\./g, '_');
  return `./logs/log-${timestamp}.txt`;
};

const throwIfErrorV1 = (response: OBAListResponseV1, msg = "Server error") => {
  if (!response.data || !response.data.list || !response.data.references || response.data.limitExceeded) {
    throw new Error(msg);
  }
};

const throwIfErrorV2 = (response: OBAListResponseV2, msg = "Server error") => {
  if (!response.data || !response.data.references) {
    throw new Error(msg);
  }
};

const env = (varName: string): string => {
  const value = process.env[varName];
  if (typeof value === 'undefined') throw new Error(`Missing env var: ${varName}`);
  return value;
};

// we are interested in just one particular agency route stop, both directions
const AGENCY_NAME = env('AGENCY_NAME');
const ROUTE_SHORTNAME = env('ROUTE_SHORTNAME');
const STOP_NAME = env('STOP_NAME');

// OneBusAway API endpoint
const OBA_API_KEY = env('OBA_API_KEY');
const OBA_API_URL = env('OBA_API_URL');

// DEBUGGING
let VERBOSE = true;
VERBOSE = false;
let LOG_REQ_RESP = true;
const LOG_FILE = generateLogFilename();

const client = new OnebusawaySDK({
  apiKey: OBA_API_KEY,
  baseURL: OBA_API_URL,
  fetch: async (url, init?) => {
    if (VERBOSE) console.log('\n===REQUEST===', url, inspect(init));
    if (LOG_REQ_RESP) {
      await fs.appendFile(LOG_FILE, `\n------------------------------------------------------------------------------\nRequest:\n${url}\n${JSON.stringify(init, null, 2)}`);
    }
    const response = await fetch(url, init);
    if (VERBOSE) console.log('\n===RESPONSE===', inspect(response), '\n\n');
    if (LOG_REQ_RESP) {
      await fs.appendFile(LOG_FILE, `\n\nResponse:\n${JSON.stringify(await response.clone().json(), null, 2)}\n\n`);
    }
    return response;
  },
});

// 0. Find OBA version info
// const config = await client.config.retrieve();
// console.log("Config:", inspect(config.data.entry));
// process.exit();

// 1. Find agency by name
const agencies = await client.agenciesWithCoverage.list();
throwIfErrorV1(agencies)
const agency = agencies.data.references.agencies
  .find(agency => agency.name == AGENCY_NAME);
console.log('Target agency:', inspect(agency));
if (!agency) throw new Error("Agency not found");

// 2. Find route by short-name within the target agency
const routes = await client.routesForAgency.list(agency.id);
throwIfErrorV1(routes);
const route = routes.data.list
  .find(route => route.shortName == ROUTE_SHORTNAME);
console.log("Target route:", inspect(route));
if (!route) throw new Error("Route not found");

// 3. Find stop (both groups/directions) by name, route, and day (today)
const stopsForRoute = await client.stopsForRoute.list(route.id, {
  includePolylines: false,
  time: Date.now().toString(),
});
throwIfErrorV2(stopsForRoute);
const stopRefs = stopsForRoute.data.references.stops
  .filter(stop => stop.name == STOP_NAME);

// The TypeScript client types don't accurately describe the actual response data.
// They also mismatches the docs: https://developer.onebusaway.org/api/where/methods/stops-for-route
// Could be bug or version discrepancy.
// For now, we'll override with casting of our own type aliases.

// add group/direction info to the targets by cross-referencing their stopIds
let stops: MyStop[] = [];
// @ts-expect-error
stopsForRoute.data.entry.stopGroupings?.forEach((stopGrouping: OBAStopGrouping) => {
  stopGrouping.stopGroups?.forEach(stopGroup => {
    stopGroup.stopIds?.forEach(stopId => {
      stopRefs.forEach(stopRef => {
        if (stopRef.id == stopId) {
          stops.push({
            id: stopRef.id,
            name: stopRef.name,
            code: stopRef.code,
            direction: stopRef.direction,
            group: stopGroup.name?.name,
          });
        }
      });
    });
  });
});

console.log("Target stops:", inspect(stops));

// 4. Call `arrivals-and-departures-for-stop` and find the `tripId` for target stops, in both directions/groups
// const arrivalsAndDepartures = await client.arrivalAndDeparture.list()
// const arrsAndDepsWest = await client.arrivalAndDeparture.list(STOP_ID_WEST).retrieve();
// console.log(arrsAndDepsWest);


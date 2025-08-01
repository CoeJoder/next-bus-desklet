import 'dotenv/config';
import * as fs from 'node:fs/promises';
import util from 'node:util';
import OnebusawaySDK from 'onebusaway-sdk';
import fetch from 'node-fetch';

// DEBUGGING
let VERBOSE = true;
VERBOSE = false;
let VERBOSE_DEPARTURES = true;
VERBOSE_DEPARTURES = false;
let LOG_REQ_RESP = true;

type OBAArrivalsAndDepartures = OnebusawaySDK.ArrivalAndDepartureListResponse.Data.Entry.ArrivalsAndDeparture;

type OBAStopGroup = OnebusawaySDK.StopsForRouteListResponse.Data.Entry.StopGrouping;

interface OBAStopGrouping {
  stopGroups?: OBAStopGroup[],
}

type OBAListResponseV1 = 
  | OnebusawaySDK.RoutesForAgencyListResponse
  | OnebusawaySDK.AgenciesWithCoverageListResponse;
  
type OBAListResponseV2 = 
  | OnebusawaySDK.StopsForRouteListResponse
  | OnebusawaySDK.ArrivalAndDepartureListResponse;

interface Stop {
  id: string,
  name: string,
  code?: string,
  direction?: string,
  group?: string, 
}

interface StopDepartures {
  stop: Stop,
  arrivalsAndDepartures: OBAArrivalsAndDepartures[],
}

interface NextDeparture {
  scheduledDepartureTime: string,
  isPredicted: boolean,
  isLate?: boolean,
  isEarly?: boolean,
  timeOffset?: string,
  predictedDepartureTime?: string,
}

const inspect = (obj: unknown) => {
  return util.inspect(obj, {
    colors: true,
    depth: 100,
    maxArrayLength: 100,
    sorted: true,
    breakLength: 140,
  });
};

const formatTimestamp = (ms: number) => {
  return new Date(ms).toLocaleString(); 
};

const formatTimedelta = (ms: number) => {
  if (ms < 0) {
    ms = -ms;
  }
  const hours = Math.floor(ms / 3_600_000); 
  ms %= 3_600_000;

  const minutes = Math.floor(ms / 60_000);
  ms %= 60_000;

  const seconds = Math.floor(ms / 1_000);

  const parts = [];
  if (hours > 0) {
    parts.push(hours + 'h');
  }
  if (minutes > 0) {
    parts.push(minutes + 'm');
  }
  if (seconds > 0) {
    parts.push(seconds + 's');
  }
  return parts.join(' ');
};

const nHoursAgo = (hoursAgo: number) => {
  const date = new Date();
  date.setHours(date.getHours() - hoursAgo);
  return date.getTime();
};

const nHoursAhead = (hoursAhead: number) => {
  const date = new Date();
  date.setHours(date.getHours() + hoursAhead);
  return date.getTime();
};

const generateLogFilename = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `./logs/log-${year}-${month}-${day}_${hours}-${minutes}-${seconds}.txt`;
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
const MAX_DEPARTURES_PER_DIRECTION = parseInt(env('MAX_DEPARTURES_PER_DIRECTION'));
if (isNaN(MAX_DEPARTURES_PER_DIRECTION)) {
  throw new Error(`Env var not a number: MAX_DEPARTURES_PER_DIRECTION`);
}
const DEPARTURES_SEARCH_MINUTES = 24 * 60;

// OneBusAway API endpoint
const OBA_API_KEY = env('OBA_API_KEY');
const OBA_API_URL = env('OBA_API_URL');

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
// try {
//   const config = await client.config.retrieve();
//   console.log("Config:", inspect(config.data.entry));
// } catch (e) {
//   console.log("API/server Error:", inspect(e));
// }
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
const stops: Stop[] = [];
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
if (stops.length == 0) throw new Error("Stop groups not found");
console.log("Target stops:", inspect(stops));

// 4. Find the next arrivals/departures for given stops within the search time range
const departures: StopDepartures[] = []
for (const stop of stops) {
  const aNds = await client.arrivalAndDeparture.list(stop.id, {
    // time: String(nHoursAhead(2)),
    minutesBefore: 0,
    minutesAfter: DEPARTURES_SEARCH_MINUTES,
  });
  throwIfErrorV2(aNds);
  departures.push({
    stop,
    arrivalsAndDepartures: aNds.data.entry.arrivalsAndDepartures,
  });

  if (VERBOSE_DEPARTURES) {
    // make timestamps human-readable
    const readable = JSON.parse(JSON.stringify(aNds));
    readable.currentTime = formatTimestamp(readable.currentTime);
    readable.data.entry.arrivalsAndDepartures.forEach((aNd: OBAArrivalsAndDepartures) => {
      // @ts-expect-error
      if (aNd.lastUpdateTime) aNd.lastUpdateTimeReadable = formatTimestamp(aNd.lastUpdateTime);
      if (aNd.tripStatus?.predicted) {
        // @ts-expect-error
        aNd.predictedArrivalTimeReadable = formatTimestamp(aNd.predictedArrivalTime);
        // @ts-expect-error
        aNd.predictedDepartureTimeReadable = formatTimestamp(aNd.predictedDepartureTime);
      } 
      // @ts-expect-error
      aNd.scheduledArrivalTimeReadable = formatTimestamp(aNd.scheduledArrivalTime);
      // @ts-expect-error
      aNd.scheduledDepartureTimeReadable = formatTimestamp(aNd.scheduledDepartureTime);
      // @ts-expect-error
      aNd.serviceDateReadable = formatTimestamp(aNd.serviceDate);
      // @ts-expect-error
      if (aNd.tripStatus?.serviceDate) aNd.tripStatus.serviceDateReadable = formatTimestamp(aNd.tripStatus.serviceDate);
      // @ts-expect-error
      if (aNd.tripStatus?.lastLocationUpdateTime) aNd.tripStatus.lastLocationUpdateTimeReadable = formatTimestamp(aNd.tripStatus.lastLocationUpdateTime);
      // @ts-expect-error
      if (aNd.tripStatus?.lastUpdateTime) aNd.tripStatus.lastUpdateTimeReadable = formatTimestamp(aNd.tripStatus.lastUpdateTime);
    });
    console.log(`${stop.id} AnDs:`, inspect(readable));
  }
}
if (departures.length == 0) throw new Error("Departures not found");

// 5. UI data validation and preparation
if (departures.length === 0) {
  throw new Error("No departures found");
}
const stopName = departures[0].stop.name;
const groupToNextDepartures: Record<string, NextDeparture[]> = {};
departures.forEach(departure => {
  if (departure.stop.name != stopName) {
    throw new Error(`Mismatched stop name (expected ${stopName}, found ${departure.stop.name}`);
  }
  if (!departure.stop.group) {
    throw new Error(`No group found for stopId: ${departure.stop.id}`);
  }
  const nextDepartures: NextDeparture[] = [];
  for (let i = 0; i < Math.min(departure.arrivalsAndDepartures.length, MAX_DEPARTURES_PER_DIRECTION); i++) {
    const aNd = departure.arrivalsAndDepartures[i];
    const nextDeparture: NextDeparture = {
      isPredicted: aNd.tripStatus?.predicted ?? false,
      scheduledDepartureTime: formatTimestamp(aNd.scheduledDepartureTime),
    };
    // check if on-time
    if (aNd.tripStatus?.predicted && aNd.predictedArrivalTime != 0 && aNd.scheduledArrivalTime != 0) {
      nextDeparture.predictedDepartureTime = formatTimestamp(aNd.predictedDepartureTime);
      const timeOffset = aNd.predictedArrivalTime - aNd.scheduledArrivalTime;
      nextDeparture.timeOffset = formatTimedelta(timeOffset);
      nextDeparture.isEarly = timeOffset > 0;
      nextDeparture.isLate = timeOffset < 0;
    }
    nextDepartures.push(nextDeparture);
  }
  groupToNextDepartures[departure.stop.group] = nextDepartures;
});
console.log("Next departures:", inspect(groupToNextDepartures));

// 6. UI display
let output = `\nStop: ${stopName}\n`;
for (const [group, nextDepartures] of Object.entries(groupToNextDepartures)) {
  output += `Direction: ${group}\n`;
  if (nextDepartures.length === 0) {
    output += `  No departures found\n`;
  } else {
    nextDepartures.forEach(nextDeparture => {
      if (nextDeparture.isPredicted) {
        output += `  Departing at: ${nextDeparture.predictedDepartureTime}`;
        if (nextDeparture.isLate) {
          output += ` (${nextDeparture.timeOffset} later than scheduled: ${nextDeparture.scheduledDepartureTime})`;
        } else if (nextDeparture.isEarly) {
          output += ` (${nextDeparture.timeOffset} earlier than scheduled: ${nextDeparture.scheduledDepartureTime})`;
        }
        output += `\n`;
      } else {
        output += `  Departing at: ${nextDeparture.scheduledDepartureTime}\n`;
      }
    });
  }
}
console.log(output);

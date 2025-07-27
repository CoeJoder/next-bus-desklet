import 'dotenv/config';
import * as fs from 'node:fs/promises';
import util from 'node:util';
import OnebusawaySDK from 'onebusaway-sdk';
import fetch from 'node-fetch';

type OBAListResponse = 
  | OnebusawaySDK.RoutesForAgency.RoutesForAgencyListResponse
  | OnebusawaySDK.AgenciesWithCoverage.AgenciesWithCoverageListResponse;

const inspect = (obj: unknown) => {
  return util.inspect(obj, {
    colors: true,
    depth: 10,
    maxArrayLength: 10,
    sorted: true,
    breakLength: 120,
  })
};

const generateLogFilename = () => {
  const date = new Date();
  const timestamp = date.toISOString().replace(/:/g, '-').replace(/\./g, '_');
  return `./logs/log-${timestamp}.txt`;
}

const throwIfError = (response: OBAListResponse, msg = "Server error") => {
  if (!response.data || !response.data.list || !response.data.references || response.data.limitExceeded) {
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
const STOP_ID_EAST = env('STOP_ID_EAST');
const STOP_ID_WEST = env('STOP_ID_WEST');

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

// 1. Find agency by name
const agencies = await client.agenciesWithCoverage.list();
throwIfError(agencies)
const agency = agencies.data.references.agencies
  .find(agency => agency.name == AGENCY_NAME);
console.log('Target agency:', inspect(agency));
if (!agency) throw new Error("Agency not found");

// 2. Find route by short-name within the target agency
const routes = await client.routesForAgency.list(agency.id);
throwIfError(routes);
const route = routes.data.list
  .find(route => route.shortName == ROUTE_SHORTNAME);
console.log("Target route:", inspect(route));
if (!route) throw new Error("Route not found");

// 3. Call `arrivals-and-departures-for-stop` and find the `tripId` for my stop, going EAST and WEST
// const arrsAndDepsWest = await client.arrivalAndDeparture.list(STOP_ID_WEST).retrieve();
// console.log(arrsAndDepsWest);


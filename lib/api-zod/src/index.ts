export * from "./generated/api";
export * from "./storage-schemas";
export * from "./generated/types";

// Orval generates a Zod schema and a TypeScript type with the same name for
// these request bodies. Re-export the Zod schemas explicitly so the API can
// validate with them (an ambiguous star export would drop both).
export {
  CompleteBallBoiSessionBody,
  CreateLeagueBody,
  CreateLeagueInviteBody,
  CreateMatchBody,
  EndMatchBallBoiBody,
  GenerateLeagueRoundBody,
  GetLeagueStandingsParams,
  MatchBallBoiShotCallbackBody,
  StartBallBoiSessionBody,
  UpdateLeagueBody,
  UpdateMatchBody,
  UpdatePlayerBody,
  UpdateSeasonBody,
} from "./generated/api";

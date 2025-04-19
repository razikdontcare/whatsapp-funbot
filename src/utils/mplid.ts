import axios from "axios";
import { log } from "../core/config.js";

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface TeamData {
  id: string;
  name: string;
  logo?: string;
  players?: PlayerData[];
  matches?: TeamMatchData[];
}

export interface TeamMatchData {
  id: number;
  home: {
    team: TeamData;
    score?: number;
  };
  away: {
    team: TeamData;
    score?: number;
  };
  details: {
    date: Date;
    week: number;
    status: "lose" | "win" | "upcoming";
  };
}

export interface PlayerData {
  id: number;
  name: string;
  role?: string;
  photo?: string;
}

export interface MatchData {
  id: string;
  homeTeam: TeamData;
  awayTeam: TeamData;
  schedule: Date;
  score?: {
    home: number;
    away: number;
  };
  status: "upcoming" | "live" | "completed";
}

export interface WeekData {
  week: number;
  schedules: {
    day: number;
    date: Date;
    matches: MatchData[];
  }[];
}

export interface StandingData {
  team: TeamData;
  position: number;
  match: {
    points: number;
    win: number;
    lose: number;
  };
  game: {
    net: number;
    win: number;
    lose: number;
  };
}

const BASE_URL = "https://mplid-api.razik.net";

const mplidClient = axios.create({
  baseURL: BASE_URL,
  timeout: 5000,
  family: 4,
});

export async function getAllTeams(): Promise<ApiResponse<TeamData[]>> {
  try {
    const response = await mplidClient.get<ApiResponse<TeamData[]>>(
      "/api/teams"
    );
    return response.data;
  } catch (error) {
    log.error("Error fetching all teams:", error);
    throw error;
  }
}

// Overloads for getTeamById
export async function getTeamById(id: string, image: true): Promise<Buffer>;
export async function getTeamById(
  id: string,
  image?: false
): Promise<ApiResponse<TeamData>>;
export async function getTeamById(
  id: string,
  image?: boolean
): Promise<ApiResponse<TeamData> | Buffer> {
  try {
    const config = image ? { responseType: "arraybuffer" as const } : undefined;
    const response = await mplidClient.get(
      `/api/teams/${id}${image ? "/image" : ""}`,
      config
    );
    if (image) {
      return Buffer.from(response.data);
    }
    return response.data;
  } catch (error) {
    log.error("Error fetching team by ID:", error);
    throw error;
  }
}

// Overloads for getSchedules
export async function getSchedules(image: true): Promise<Buffer>;
export async function getSchedules(
  image?: false
): Promise<ApiResponse<WeekData[]>>;
export async function getSchedules(
  image?: boolean
): Promise<ApiResponse<WeekData[]> | Buffer> {
  try {
    const config = image ? { responseType: "arraybuffer" as const } : undefined;
    const response = await mplidClient.get(
      "/api/schedules" + (image ? "/image" : ""),
      config
    );
    if (image) {
      return Buffer.from(response.data);
    }
    return response.data;
  } catch (error) {
    log.error("Error fetching schedules:", error);
    throw error;
  }
}

// Overloads for getStandings
export async function getStandings(image: true): Promise<Buffer>;
export async function getStandings(
  image?: false
): Promise<ApiResponse<StandingData[]>>;
export async function getStandings(
  image?: boolean
): Promise<ApiResponse<StandingData[]> | Buffer> {
  try {
    const config = image ? { responseType: "arraybuffer" as const } : undefined;
    const response = await mplidClient.get(
      "/api/standings" + (image ? "/image" : ""),
      config
    );
    if (image) {
      return Buffer.from(response.data);
    }
    return response.data;
  } catch (error) {
    log.error("Error fetching standings:", error);
    throw error;
  }
}

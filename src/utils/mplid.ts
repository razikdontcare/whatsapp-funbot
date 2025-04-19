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

export async function getTeamById(
  id: string,
  image?: boolean
): Promise<ApiResponse<TeamData>> {
  try {
    const response = await mplidClient.get<ApiResponse<TeamData>>(
      `/api/teams/${id}${image ? "/image" : ""}`
    );
    return response.data;
  } catch (error) {
    log.error("Error fetching team by ID:", error);
    throw error;
  }
}

export async function getSchedules(
  image?: boolean
): Promise<ApiResponse<WeekData[]>> {
  try {
    const response = await mplidClient.get<ApiResponse<WeekData[]>>(
      "/api/schedules" + (image ? "/image" : "")
    );
    return response.data;
  } catch (error) {
    log.error("Error fetching schedules:", error);
    throw error;
  }
}

export async function getStandings(
  image?: boolean
): Promise<ApiResponse<StandingData[]>> {
  try {
    const response = await mplidClient.get<ApiResponse<StandingData[]>>(
      "/api/standings" + (image ? "/image" : "")
    );
    return response.data;
  } catch (error) {
    log.error("Error fetching standings:", error);
    throw error;
  }
}

import dotenv from "dotenv";
import Express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import morgan from "morgan";
import http from "http";
import EngineIO from "engine.io";
import { createHandyClient, IHandyRedis } from "handy-redis";
import { Server } from "@overnightjs/core";

import LobbiesController from "./lobby";
import GameSocket from "./socket";
import { RedisEvents } from "./helpers";
import { RedisClient, createClient } from "redis";
import Database from "./db";

dotenv.config();

export class Gameserver extends Server {
  private httpServer!: http.Server;
  public io!: EngineIO.Server;
  public redis!: IHandyRedis;
  private subRedis!: RedisClient;
  public eventBus!: RedisEvents;
  public DB!: Database;

  private sockets: GameSocket[] = [];

  constructor() {
    super(process.env.NODE_ENV === "development");
    this.app.use(bodyParser.json());
    this.app.use(
      cors({
        origin: (e, cb) => cb(null, true),
        credentials: true
      })
    );
    this.app.use(morgan("dev"));

    this.setupRedis();

    this.setupControllers();
  }

  private setupRedis() {
    const str = process.env.REDIS_URL;
    if (typeof str !== "string") {
      throw new Error(`No environment REDIS_URL set!`);
    }
    this.redis = createHandyClient(str);
    this.DB = new Database(this.redis);
    this.subRedis = createClient(str);
    this.eventBus = new RedisEvents(this.subRedis);
  }

  private setupSocket() {
    this.io = EngineIO.attach(this.httpServer);
    this.io.on("connection", sock => {
      console.log(`hello ${sock.id}`);
      let gs: GameSocket | null = new GameSocket(this, sock);
      this.sockets.push(gs);
      sock.on("close", (reason, desc) => {
        console.log(
          `goodbye ${sock.id} ("${reason}" "${desc ? desc.message : ""}")`
        );
        this.sockets.splice(this.sockets.indexOf(gs!), 1);
        gs = null;
      });
    });
  }

  private setupControllers() {
    const lobby = new LobbiesController(this);

    this.addControllers([lobby]);
  }

  public start() {
    const port = process.env.PORT || 80;
    this.httpServer = http.createServer(this.app);
    this.httpServer.listen(port);
    console.log(`Gameserver running on port ${port}`);
    console.log("Starting socket...");
    this.setupSocket();
    console.log("Socket done.");
  }
}

if (process.env.NODE_ENV !== "test") {
  const server = new Gameserver();
  server.start();
}

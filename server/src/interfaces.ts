import { Gameserver } from ".";
import { Lobby } from "./lobby";

export class Player {
    public lobby!: Lobby;

    public id!: string;
    public name!: string;
    public rtcConnectionString!: string;
    public isHost!: boolean;
    public isReady!: boolean;
    public isConnected: boolean = false;

    constructor() {}

    public toJson() {
        return {
            id: this.id,
            name: this.name,
            rtcConnectionString: this.rtcConnectionString,
            isHost: this.isHost,
            isReady: this.isReady,
            isConnected: this.isConnected
        };
    }

    static async createFromRedisWithId(server: Gameserver, lobby: Lobby, playerId: string) {
        const json = await server.redis.hget(`lobbies:${lobby.id}:players`, playerId);
        if (json === null) {
            throw new Error(`Could not find player for ${lobby.id}/${playerId}`);
        }
        const data = JSON.parse(json);
        const player = new Player();
        Object.keys(data).forEach(key => {
            (player as any)[key] = data[key];
        });

        player.lobby = lobby;

        return player;
    }
}
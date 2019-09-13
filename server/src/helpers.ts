import { RedisClient } from "redis";

export function serialize(obj: any): string {
  return JSON.stringify(obj, function(key, value) {
    if (typeof value === "object" && value !== null && "toJson" in value) {
      return value.toJson();
    }
    return value;
  });
}

type Listener = (data: string, channel: string) => any;

export class RedisEvents {
  private handlers: { [ChannelOrPattern: string]: number } = {};

  constructor(private readonly redis: RedisClient) {}

  subscribe(channel: string, listener: Listener) {
    this.redis.subscribe([channel]);
    const handler = (_channel: string, message: string) => {
      if (_channel === channel) {
        listener(message, channel);
      }
    };
    this.redis.on("message", handler);
    if (channel in this.handlers) {
      this.handlers[channel]++;
    } else {
      this.handlers[channel] = 1;
    }
    return () => {
      this.redis.off("message", handler);
      if (--this.handlers[channel] === 0) {
        this.redis.unsubscribe([channel]);
      }
    };
  }

  psubscribe(pattern: string, listener: Listener) {
    this.redis.psubscribe([pattern]);
    const handler = (_pattern: string, _channel: string, message: string) => {
      if (_pattern === pattern) {
        listener(message, _channel);
      }
    };
    this.redis.on("pmessage", handler);
    if (pattern in this.handlers) {
      this.handlers[pattern]++;
    } else {
      this.handlers[pattern] = 1;
    }
    return () => {
      this.redis.off("message", handler);
      if (--this.handlers[pattern] === 0) {
        this.redis.unsubscribe([pattern]);
      }
    };
  }
}

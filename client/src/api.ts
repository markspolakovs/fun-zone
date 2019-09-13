const API_BASE = "http://localhost:2000";

export class ApiError extends Error {
  constructor(
    message?: string,
    public readonly code?: number,
    public readonly data?: any
  ) {
    super(message);
  }
}

export async function apiCall(path: string, args: any) {
  const data = JSON.stringify(args);
  const rez = await fetch(API_BASE + path, {
    method: "post",
    headers: {
      "Content-Type": "application/json"
    },
    body: data
  });
  const json = await rez.json();
  if (json.ok) {
    return json;
  } else {
    throw new ApiError("API NOT OK", rez.status, json);
  }
}

export interface JWTPayload {
    sub: number; // user ID
    email: string;
    name: string;
    role: string;
}
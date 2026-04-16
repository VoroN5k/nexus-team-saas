export interface JWTPayload {
    sub: string; // user ID
    email: string;
    firstName: string;
    lastName: string;
}
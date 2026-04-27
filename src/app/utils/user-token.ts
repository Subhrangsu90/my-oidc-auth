export interface JWTClaims {
	iss: string;
	sub: string;
	aud: string;
	email: string;
	email_verified: boolean;
	iat: number;
	exp: number;
	family_name?: string;
	given_name: string;
	name: string;
	picture?: string;
}

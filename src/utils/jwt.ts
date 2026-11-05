import { SignJWT, jwtVerify } from 'jose';

// Create token
export const createToken = async (
  payload: any,
  expiration: Date,
  secret: string,
) => {
  const s = new TextEncoder().encode(secret);

  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(s);
};

// Verify token
export const verifyToken = async (token: string, secret: string) => {
  const s = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, s);
  return payload;
};

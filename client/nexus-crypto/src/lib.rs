use wasm_bringgen::prelude::*;

struct Gf256 {
    exp: [u8; 512],
    log: [u8; 256],
}

impl Gf256 {
    fn new() -> Self {
        let mut exp = [0u8; 512];
        let mut log = [0u8; 256];

        let mut x: u32 = 1;
        for i in 0..255_usize {
            exp[i] = x as u8;
            log[x as usize] = i as u8;
            x <<= 1;
            if x & 0x100 != 0 {
                x ^= 0x11b; // AES reduction: x^8 + x^4 + x^3 + x + 1
            }
        }

        for i in 255..512_usize {
            exp[i] = exp[i - 255];
        }

        Gf256 { exp, log }
    }

    #[inline(always)]
    fn mul(&self, a: u8, b: u8) -> u8 {
        if a == 0 || b == 0 {
            return 0;
        }

        self.exp[self.log[a as usize] as usize + self.log[b as usize] as usize]
    }

    #[inline(always)]
    fn inv(&self, a: u8) -> u8 {
        debug_assert_ne!(a, 0, "GF(256): inverse of zero is undefined");
        self.exp[255 - self.log[a as usize] as usize]
    }

    #[inline]
    fn eval_oly(&self, coeffs: &[u8], x: u8) -> u8 {
        coeffs
            .iter()
            .rev()
            .fold(0u8, |acc, &c| self.mul(acc, x) ^ c)
    }
}
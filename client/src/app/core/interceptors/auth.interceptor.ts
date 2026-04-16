import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { catchError, switchMap, throwError } from 'rxjs';
import { Router } from '@angular/router';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token();

  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError((err: HttpErrorResponse) => {
      // On 401, attempt one token refresh then retry
      if (err.status === 401 && !req.url.includes('/refresh') && !req.url.includes('/login')) {
        return auth.refresh().pipe(
          switchMap(r => {
            const retried = req.clone({ setHeaders: { Authorization: `Bearer ${r.accessToken}` } });
            return next(retried);
          }),
          catchError(refreshErr => {
            // Clear token and redirect to login to avoid leaving UI in inconsistent state
            auth.clearToken();
            try { router.navigate(['/login']); } catch (_) {}
            return throwError(() => refreshErr);
          })
        );
      }
      return throwError(() => err);
    })
  );
};

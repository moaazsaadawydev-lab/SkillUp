export type PaginationOptions = {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
};

export type PaginatedResult<T> = {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
};

export type ApiResponse<T> = {
  success: boolean;
  statusCode: number;
  message?: string;
  data?: T;
  error?: string | Record<string, unknown>;
  timestamp: string;
};

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { queryKey, sleep } from '@tanstack/query-test-utils'
import { QueryCache, QueryClient, QueryObserver } from '..'

describe('queryCache', () => {
  let queryClient: QueryClient
  let queryCache: QueryCache

  beforeEach(() => {
    vi.useFakeTimers()
    queryClient = new QueryClient()
    queryCache = queryClient.getQueryCache()
  })

  afterEach(() => {
    queryClient.clear()
    vi.useRealTimers()
  })

  describe('subscribe', () => {
    test('should pass the correct query', () => {
      const key = queryKey()
      const subscriber = vi.fn()
      const unsubscribe = queryCache.subscribe(subscriber)
      queryClient.setQueryData(key, 'foo')
      const query = queryCache.find({ queryKey: key })
      expect(subscriber).toHaveBeenCalledWith({ query, type: 'added' })
      unsubscribe()
    })

    test('should notify listeners when new query is added', async () => {
      const key = queryKey()
      const callback = vi.fn()
      queryCache.subscribe(callback)
      queryClient.prefetchQuery({
        queryKey: key,
        queryFn: () => sleep(100).then(() => 'data'),
      })
      await vi.advanceTimersByTimeAsync(100)
      expect(callback).toHaveBeenCalled()
    })

    test('should notify query cache when a query becomes stale', async () => {
      const key = queryKey()
      const events: Array<string> = []
      const queries: Array<unknown> = []
      const unsubscribe = queryCache.subscribe((event) => {
        events.push(event.type)
        queries.push(event.query)
      })

      const observer = new QueryObserver(queryClient, {
        queryKey: key,
        queryFn: () => 'data',
        staleTime: 10,
      })

      const unsubScribeObserver = observer.subscribe(vi.fn())

      await vi.advanceTimersByTimeAsync(11)
      expect(events.length).toBe(8)

      expect(events).toEqual([
        'added', // 1. Query added -> loading
        'observerResultsUpdated', // 2. Observer result updated -> loading
        'observerAdded', // 3. Observer added
        'observerResultsUpdated', // 4. Observer result updated -> fetching
        'updated', // 5. Query updated -> fetching
        'observerResultsUpdated', // 6. Observer result updated -> success
        'updated', // 7. Query updated -> success
        'observerResultsUpdated', // 8. Observer result updated -> stale
      ])

      queries.forEach((query) => {
        expect(query).toBeDefined()
      })

      unsubscribe()
      unsubScribeObserver()
    })

    test('should include the queryCache and query when notifying listeners', async () => {
      const key = queryKey()
      const callback = vi.fn()
      queryCache.subscribe(callback)
      queryClient.prefetchQuery({
        queryKey: key,
        queryFn: () => sleep(100).then(() => 'data'),
      })
      await vi.advanceTimersByTimeAsync(100)
      const query = queryCache.find({ queryKey: key })
      expect(callback).toHaveBeenCalledWith({ query, type: 'added' })
    })

    test('should notify subscribers when new query with initialData is added', async () => {
      const key = queryKey()
      const callback = vi.fn()
      queryCache.subscribe(callback)
      queryClient.prefetchQuery({
        queryKey: key,
        queryFn: () => sleep(100).then(() => 'data'),
        initialData: 'initial',
      })
      await vi.advanceTimersByTimeAsync(100)
      expect(callback).toHaveBeenCalled()
    })

    test('should be able to limit cache size', async () => {
      const testCache = new QueryCache()

      const unsubscribe = testCache.subscribe((event) => {
        if (event.type === 'added') {
          if (testCache.getAll().length > 2) {
            testCache
              .findAll({
                type: 'inactive',
                predicate: (q) => q !== event.query,
              })
              .forEach((query) => {
                testCache.remove(query)
              })
          }
        }
      })

      const testClient = new QueryClient({ queryCache: testCache })

      testClient.prefetchQuery({
        queryKey: ['key1'],
        queryFn: () => sleep(100).then(() => 'data1'),
      })
      expect(testCache.findAll().length).toBe(1)
      testClient.prefetchQuery({
        queryKey: ['key2'],
        queryFn: () => sleep(100).then(() => 'data2'),
      })
      expect(testCache.findAll().length).toBe(2)
      testClient.prefetchQuery({
        queryKey: ['key3'],
        queryFn: () => sleep(100).then(() => 'data3'),
      })
      await vi.advanceTimersByTimeAsync(100)
      expect(testCache.findAll().length).toBe(1)
      expect(testCache.findAll()[0]!.state.data).toBe('data3')

      unsubscribe()
    })
  })

  describe('find', () => {
    test('find should filter correctly', async () => {
      const key = queryKey()
      queryClient.prefetchQuery({
        queryKey: key,
        queryFn: () => sleep(100).then(() => 'data1'),
      })
      await vi.advanceTimersByTimeAsync(100)
      const query = queryCache.find({ queryKey: key })!
      expect(query).toBeDefined()
    })

    test('find should filter correctly with exact set to false', async () => {
      const key = queryKey()
      queryClient.prefetchQuery({
        queryKey: key,
        queryFn: () => sleep(100).then(() => 'data1'),
      })
      await vi.advanceTimersByTimeAsync(100)
      const query = queryCache.find({ queryKey: key, exact: false })!
      expect(query).toBeDefined()
    })
  })

  describe('findAll', () => {
    test('should filter correctly', async () => {
      const key1 = queryKey()
      const key2 = queryKey()
      const keyFetching = queryKey()
      queryClient.prefetchQuery({
        queryKey: key1,
        queryFn: () => sleep(100).then(() => 'data1'),
      })
      queryClient.prefetchQuery({
        queryKey: key2,
        queryFn: () => sleep(100).then(() => 'data2'),
      })
      queryClient.prefetchQuery({
        queryKey: [{ a: 'a', b: 'b' }],
        queryFn: () => sleep(100).then(() => 'data3'),
      })
      queryClient.prefetchQuery({
        queryKey: ['posts', 1],
        queryFn: () => sleep(100).then(() => 'data4'),
      })
      await vi.advanceTimersByTimeAsync(100)
      queryClient.invalidateQueries({ queryKey: key2 })
      const query1 = queryCache.find({ queryKey: key1 })!
      const query2 = queryCache.find({ queryKey: key2 })!
      const query3 = queryCache.find({ queryKey: [{ a: 'a', b: 'b' }] })!
      const query4 = queryCache.find({ queryKey: ['posts', 1] })!

      expect(queryCache.findAll({ queryKey: key1 })).toEqual([query1])
      // wrapping in an extra array doesn't yield the same results anymore since v4 because keys need to be an array
      expect(queryCache.findAll({ queryKey: [key1] })).toEqual([])
      expect(queryCache.findAll()).toEqual([query1, query2, query3, query4])
      expect(queryCache.findAll({})).toEqual([query1, query2, query3, query4])
      expect(queryCache.findAll({ queryKey: key1, type: 'inactive' })).toEqual([
        query1,
      ])
      expect(queryCache.findAll({ queryKey: key1, type: 'active' })).toEqual([])
      expect(queryCache.findAll({ queryKey: key1, stale: true })).toEqual([])
      expect(queryCache.findAll({ queryKey: key1, stale: false })).toEqual([
        query1,
      ])
      expect(
        queryCache.findAll({ queryKey: key1, stale: false, type: 'active' }),
      ).toEqual([])
      expect(
        queryCache.findAll({
          queryKey: key1,
          stale: false,
          type: 'inactive',
        }),
      ).toEqual([query1])
      expect(
        queryCache.findAll({
          queryKey: key1,
          stale: false,
          type: 'inactive',
          exact: true,
        }),
      ).toEqual([query1])

      expect(queryCache.findAll({ queryKey: key2 })).toEqual([query2])
      expect(queryCache.findAll({ queryKey: key2, stale: undefined })).toEqual([
        query2,
      ])
      expect(queryCache.findAll({ queryKey: key2, stale: true })).toEqual([
        query2,
      ])
      expect(queryCache.findAll({ queryKey: key2, stale: false })).toEqual([])
      expect(queryCache.findAll({ queryKey: [{ b: 'b' }] })).toEqual([query3])
      expect(
        queryCache.findAll({ queryKey: [{ a: 'a' }], exact: false }),
      ).toEqual([query3])
      expect(
        queryCache.findAll({ queryKey: [{ a: 'a' }], exact: true }),
      ).toEqual([])
      expect(
        queryCache.findAll({ queryKey: [{ a: 'a', b: 'b' }], exact: true }),
      ).toEqual([query3])
      expect(queryCache.findAll({ queryKey: [{ a: 'a', b: 'b' }] })).toEqual([
        query3,
      ])
      expect(
        queryCache.findAll({ queryKey: [{ a: 'a', b: 'b', c: 'c' }] }),
      ).toEqual([])
      expect(
        queryCache.findAll({ queryKey: [{ a: 'a' }], stale: false }),
      ).toEqual([query3])
      expect(
        queryCache.findAll({ queryKey: [{ a: 'a' }], stale: true }),
      ).toEqual([])
      expect(
        queryCache.findAll({ queryKey: [{ a: 'a' }], type: 'active' }),
      ).toEqual([])
      expect(
        queryCache.findAll({ queryKey: [{ a: 'a' }], type: 'inactive' }),
      ).toEqual([query3])
      expect(
        queryCache.findAll({ predicate: (query) => query === query3 }),
      ).toEqual([query3])
      expect(queryCache.findAll({ queryKey: ['posts'] })).toEqual([query4])

      expect(queryCache.findAll({ fetchStatus: 'idle' })).toEqual([
        query1,
        query2,
        query3,
        query4,
      ])
      expect(
        queryCache.findAll({ queryKey: key2, fetchStatus: undefined }),
      ).toEqual([query2])

      queryClient.prefetchQuery({
        queryKey: keyFetching,
        queryFn: () => sleep(20).then(() => 'dataFetching'),
      })
      expect(queryCache.findAll({ fetchStatus: 'fetching' })).toEqual([
        queryCache.find({ queryKey: keyFetching }),
      ])
      await vi.advanceTimersByTimeAsync(20)
      expect(queryCache.findAll({ fetchStatus: 'fetching' })).toEqual([])
    })

    test('should return all the queries when no filters are defined', async () => {
      const key1 = queryKey()
      const key2 = queryKey()
      await queryClient.prefetchQuery({
        queryKey: key1,
        queryFn: () => 'data1',
      })
      await queryClient.prefetchQuery({
        queryKey: key2,
        queryFn: () => 'data2',
      })
      expect(queryCache.findAll().length).toBe(2)
    })
  })

  describe('QueryCacheConfig error callbacks', () => {
    test('should call onError and onSettled when a query errors', async () => {
      const key = queryKey()
      const onSuccess = vi.fn()
      const onSettled = vi.fn()
      const onError = vi.fn()
      const testCache = new QueryCache({ onSuccess, onError, onSettled })
      const testClient = new QueryClient({ queryCache: testCache })
      testClient.prefetchQuery({
        queryKey: key,
        queryFn: () => sleep(100).then(() => Promise.reject<unknown>('error')),
      })
      await vi.advanceTimersByTimeAsync(100)
      const query = testCache.find({ queryKey: key })
      expect(onError).toHaveBeenCalledWith('error', query)
      expect(onError).toHaveBeenCalledTimes(1)
      expect(onSuccess).not.toHaveBeenCalled()
      expect(onSettled).toHaveBeenCalledTimes(1)
      expect(onSettled).toHaveBeenCalledWith(undefined, 'error', query)
    })
  })

  describe('QueryCacheConfig success callbacks', () => {
    test('should call onSuccess and onSettled when a query is successful', async () => {
      const key = queryKey()
      const onSuccess = vi.fn()
      const onSettled = vi.fn()
      const onError = vi.fn()
      const testCache = new QueryCache({ onSuccess, onError, onSettled })
      const testClient = new QueryClient({ queryCache: testCache })
      testClient.prefetchQuery({
        queryKey: key,
        queryFn: () => sleep(100).then(() => ({ data: 5 })),
      })
      await vi.advanceTimersByTimeAsync(100)
      const query = testCache.find({ queryKey: key })
      expect(onSuccess).toHaveBeenCalledWith({ data: 5 }, query)
      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(onError).not.toHaveBeenCalled()
      expect(onSettled).toHaveBeenCalledTimes(1)
      expect(onSettled).toHaveBeenCalledWith({ data: 5 }, null, query)
    })
  })

  describe('QueryCache.add', () => {
    test('should not try to add a query already added to the cache', async () => {
      const key = queryKey()

      queryClient.prefetchQuery({
        queryKey: key,
        queryFn: () => sleep(100).then(() => 'data1'),
      })
      await vi.advanceTimersByTimeAsync(100)

      const query = queryCache.findAll()[0]!
      const queryClone = Object.assign({}, query)

      queryCache.add(queryClone)
      expect(queryCache.getAll().length).toEqual(1)
    })
  })
})

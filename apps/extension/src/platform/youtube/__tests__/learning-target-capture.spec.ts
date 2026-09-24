import { describe, expect, it } from 'vitest';
import { captureLearningTarget } from '../learning-target-capture';

describe('captureLearningTarget', () => {
  it('keeps the current YouTube video title for the Side Panel context', () => {
    expect(captureLearningTarget(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=playlist',
      'Một Phép Tính Có Thể Dự Đoán Ngày Tận Thế ? - Doomsday Argument - YouTube',
    )).toEqual({
      status: 'supported',
      target: {
        youtubeVideoId: 'dQw4w9WgXcQ',
        canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Một Phép Tính Có Thể Dự Đoán Ngày Tận Thế ? - Doomsday Argument',
      },
    });
  });
});

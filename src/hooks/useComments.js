import { useCallback, useEffect, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import {
  addComment,
  deleteComment,
  editComment,
  listComments,
  moderateComment,
  reportComment,
} from '../lib/commentsApi';

/**
 * The comments of one measurement (migration 015), loaded when the point panel opens.
 * Logged-in users only (the server refuses the rest). Actions throw CommentError.
 */
export default function useComments(measurementId) {
  const { currentUser, loadAuthors, reloadIssues, reloadCommentReports } = useAppData();
  const loggedIn = Boolean(currentUser);
  const [comments, setComments] = useState([]);
  const [canModerate, setCanModerate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!loggedIn || !measurementId) {
      setComments([]);
      setCanModerate(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const res = await listComments(measurementId);
      setComments(res.comments);
      setCanModerate(res.canModerate);
      loadAuthors(res.comments.map((c) => c.authorId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [loggedIn, measurementId, loadAuthors]);

  useEffect(() => {
    load();
  }, [load]);

  const replace = (next) => setComments((prev) => prev.map((c) => (c.id === next.id ? next : c)));
  const touched = (comment) => {
    if (comment?.kind === 'issue') reloadIssues();
  };

  const add = useCallback(
    async (body, lang, kind = 'comment') => {
      const c = await addComment(measurementId, body, lang, kind);
      setComments((prev) => [...prev, c]);
      touched(c);
      return c;
    },
    [measurementId, reloadIssues],
  );

  const edit = useCallback(async (id, body) => {
    const c = await editComment(id, body);
    replace(c);
    return c;
  }, []);

  const remove = useCallback(
    async (comment) => {
      await deleteComment(comment.id);
      setComments((prev) => prev.filter((c) => c.id !== comment.id));
      touched(comment);
    },
    [reloadIssues],
  );

  const moderate = useCallback(
    async (comment, action) => {
      const c = await moderateComment(comment.id, action);
      if (c) replace(c);
      else setComments((prev) => prev.filter((x) => x.id !== comment.id));
      touched(comment);
      reloadCommentReports();
    },
    [reloadIssues, reloadCommentReports],
  );

  const report = useCallback(
    async (comment, reason) => {
      const res = await reportComment(comment.id, reason);
      if (res.hidden) {
        // Hidden by the 3rd report: gone for me (unless I moderate), and the badge changes.
        await load();
        touched(comment);
        reloadCommentReports();
      } else {
        replace({ ...comment, reported: true });
        if (canModerate) reloadCommentReports();
      }
      return res;
    },
    [load, canModerate, reloadIssues, reloadCommentReports],
  );

  return { comments, canModerate, loading, error, reload: load, add, edit, remove, moderate, report };
}

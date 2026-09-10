import { useMemo, useState } from 'react';
import {
  MessageSquarePlus,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  Quote as QuoteIcon,
  ImagePlus,
  CornerDownLeft,
  MessagesSquare,
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { getUser, topicTitle, lastPostAt } from '../../data/mockData';
import { EXPERT_IDS } from '../../data/mockData';
import { relativeTime, formatDate } from '../../lib/format';
import { photoDataUri } from '../../lib/media';
import { Avatar, EmptyState } from '../primitives';
import Markdown from '../Markdown';

const CATEGORIES = ['all', 'general', 'method', 'data', 'expert'];
const REACTIONS = ['👍', '🙏', '💡', '🤔'];

function rel(t, iso) {
  const r = relativeTime(iso);
  return t(r.key, r.count != null ? { count: r.count } : undefined);
}

function ExpertBadge() {
  const { t } = useI18n();
  return (
    <span className="chip chip-active !py-0.5 text-[11px]">
      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
      {t('discussion.expertBadge')}
    </span>
  );
}

/* ------------------------------------------------------------------ list */

function TopicList({ topics, category, onCategory, onOpen, onNew }) {
  const { t, locale } = useI18n();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onCategory(c)}
              className={`chip ${category === c ? 'chip-active' : ''}`}
              aria-pressed={category === c}
            >
              {c === 'expert' && <ShieldCheck className="h-3 w-3" aria-hidden="true" />}
              {t(`discussion.categories.${c}`)}
            </button>
          ))}
        </div>
        <button type="button" className="btn-primary ms-auto" onClick={onNew}>
          <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
          {t('discussion.newTopic')}
        </button>
      </div>

      {topics.length === 0 ? (
        <EmptyState icon={MessagesSquare} title={t('discussion.empty')} />
      ) : (
        <ul className="surface divide-y divide-edge dark:divide-white/10">
          {topics.map((topic) => {
            const author = getUser(topic.authorId);
            const replies = topic.posts.length - 1;
            const hasExpert = topic.posts.some((p) => p.verifiedExpert);
            return (
              <li key={topic.id}>
                <button
                  type="button"
                  onClick={() => onOpen(topic.id)}
                  className="flex w-full items-center gap-3 p-3.5 text-start transition hover:bg-paper-sunk/60 dark:hover:bg-white/5"
                >
                  <Avatar user={author} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-ink dark:text-paper">
                        {topicTitle(topic, locale)}
                      </span>
                      {topic.category === 'expert' && <ExpertBadge />}
                      {hasExpert && topic.category !== 'expert' && (
                        <span className="inline-flex items-center gap-1 text-xs text-ok">
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                          {t('discussion.verifiedAnswer')}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
                      <span>{t('discussion.startedBy', { user: author?.displayName })}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t('discussion.topicMeta', {
                          replies,
                          time: rel(t, lastPostAt(topic)),
                        })}
                      </span>
                      {topic.tags?.length > 0 && (
                        <span className="flex gap-1">
                          {topic.tags.map((tag) => (
                            <span key={tag} className="chip !px-1.5 !py-0 text-[10px]">
                              {tag}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-ink-faint" aria-hidden="true">
                    {locale === 'he' ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- composer */

function Composer({ onSubmit, quoted, onClearQuote }) {
  const { t } = useI18n();
  const [body, setBody] = useState('');
  const [images, setImages] = useState([]);

  function addMockImage() {
    setImages((prev) => [...prev, `upload-${Date.now()}-${prev.length}`]);
  }

  return (
    <form
      className="surface space-y-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const text = body.trim();
        if (!text) return;
        onSubmit({ body: text, images });
        setBody('');
        setImages([]);
      }}
    >
      {quoted && (
        <div className="flex items-start gap-2 rounded-lg border-s-2 border-moss bg-paper-sunk/60 p-2 text-xs dark:bg-white/5">
          <QuoteIcon className="mt-0.5 h-3 w-3 shrink-0 text-moss" aria-hidden="true" />
          <span className="line-clamp-2 flex-1 text-ink-faint">{quoted.body}</span>
          <button type="button" className="text-ink-faint hover:text-ink" onClick={onClearQuote}>
            ✕
          </button>
        </div>
      )}
      <label className="sr-only" htmlFor="composer">
        {t('discussion.replyPlaceholder')}
      </label>
      <textarea
        id="composer"
        rows={3}
        className="input text-sm"
        placeholder={t('discussion.replyPlaceholder')}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img) => (
            <img
              key={img}
              src={photoDataUri(img, 120, 90)}
              alt=""
              className="h-16 w-20 rounded border border-edge object-cover dark:border-white/10"
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button type="button" className="btn-ghost px-2" onClick={addMockImage}>
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{t('discussion.attachImage')}</span>
        </button>
        <span className="text-xs text-ink-faint">{t('discussion.markdownHint')}</span>
        <button type="submit" className="btn-primary ms-auto" disabled={!body.trim()}>
          <CornerDownLeft className="h-4 w-4" aria-hidden="true" />
          {t('discussion.send')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ thread */

function Post({ topic, post, onQuote, onReact }) {
  const { t, locale } = useI18n();
  const author = getUser(post.authorId);
  const quoted = post.quotedPostId ? topic.posts.find((p) => p.id === post.quotedPostId) : null;
  const quotedAuthor = quoted ? getUser(quoted.authorId) : null;
  const isExpert = post.verifiedExpert || EXPERT_IDS.includes(post.authorId);

  return (
    <article
      className={`surface p-4 ${
        isExpert ? 'border-ok/40 bg-ok/5 dark:bg-ok/10' : ''
      }`}
    >
      <header className="mb-2 flex items-center gap-2.5">
        <Avatar user={author} size={32} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink dark:text-paper">
              {author?.displayName}
            </span>
            {isExpert && <ExpertBadge />}
            <span className="text-xs text-ink-faint">{author?.school}</span>
          </div>
          <time className="text-xs text-ink-faint" dateTime={post.createdAt}>
            {formatDate(post.createdAt, locale)} · {rel(t, post.createdAt)}
          </time>
        </div>
      </header>

      {quoted && (
        <blockquote className="mb-2 border-s-2 border-moss bg-paper-sunk/50 p-2 text-xs text-ink-faint dark:bg-white/5">
          <span className="font-medium">{quotedAuthor?.displayName}: </span>
          <span className="line-clamp-3">{quoted.body}</span>
        </blockquote>
      )}

      {post.verifiedExpert && (
        <p className="mb-1.5 inline-flex items-center gap-1 text-xs font-semibold text-ok">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {t('discussion.verifiedAnswer')}
        </p>
      )}

      <Markdown source={post.body} className="text-ink dark:text-paper" />

      {post.images?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {post.images.map((img) => (
            <img
              key={img}
              src={photoDataUri(img, 320, 220)}
              alt={t('discussion.attachImage')}
              className="max-h-48 rounded-lg border border-edge object-cover dark:border-white/10"
              loading="lazy"
            />
          ))}
        </div>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-1.5">
        {REACTIONS.map((emoji) => {
          const count = post.reactions?.[emoji] || 0;
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => onReact(post.id, emoji)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                count
                  ? 'border-moss/50 bg-moss/10 text-ink dark:text-paper'
                  : 'border-edge text-ink-faint hover:border-moss/50 dark:border-white/10'
              }`}
              aria-label={`${t('discussion.react')} ${emoji}`}
            >
              <span aria-hidden="true">{emoji}</span>
              {count > 0 && <span className="tnum">{count}</span>}
            </button>
          );
        })}
        <button
          type="button"
          className="ms-1 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink dark:hover:text-paper"
          onClick={() => onQuote(post.id)}
        >
          <QuoteIcon className="h-3 w-3" aria-hidden="true" />
          {t('discussion.quote')}
        </button>
      </footer>
    </article>
  );
}

function Thread({ topic, onBack }) {
  const { t, locale } = useI18n();
  const { addPost, toggleReaction } = useAppData();
  const [quotedId, setQuotedId] = useState(null);
  const author = getUser(topic.authorId);
  const quoted = quotedId ? topic.posts.find((p) => p.id === quotedId) : null;

  return (
    <div className="space-y-3">
      <button type="button" className="btn-ghost -ms-2" onClick={onBack}>
        {locale === 'he' ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        {t('discussion.backToTopics')}
      </button>

      <div>
        <h2 className="font-serif text-xl font-bold text-ink dark:text-paper">
          {topicTitle(topic, locale)}
        </h2>
        <p className="mt-1 text-xs text-ink-faint">
          {t('discussion.startedBy', { user: author?.displayName })} ·{' '}
          {t('discussion.inCategory', { category: t(`discussion.categories.${topic.category}`) })}
        </p>
      </div>

      <div className="space-y-3">
        {topic.posts.map((post) => (
          <Post
            key={post.id}
            topic={topic}
            post={post}
            onQuote={setQuotedId}
            onReact={(postId, emoji) => toggleReaction(topic.id, postId, emoji)}
          />
        ))}
      </div>

      <Composer
        quoted={quoted}
        onClearQuote={() => setQuotedId(null)}
        onSubmit={({ body, images }) => {
          addPost(topic.id, { body, images, quotedPostId: quotedId });
          setQuotedId(null);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ shell */

export default function Discussion({ observationId }) {
  const { topicsFor, getTopic, addTopic } = useAppData();
  const [category, setCategory] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const { t } = useI18n();

  const topics = useMemo(() => {
    const list = topicsFor(observationId);
    return category === 'all' ? list : list.filter((x) => x.category === category);
  }, [topicsFor, observationId, category]);

  const open = openId ? getTopic(openId) : null;

  if (open) return <Thread topic={open} onBack={() => setOpenId(null)} />;

  return (
    <>
      <TopicList
        topics={topics}
        category={category}
        onCategory={setCategory}
        onOpen={setOpenId}
        onNew={() => setCreating((c) => !c)}
      />
      {creating && (
        <div className="mt-3">
          <p className="mb-2 text-sm font-semibold text-ink dark:text-paper">
            {t('discussion.newTopic')}
          </p>
          <NewTopicForm
            onCreate={(title, body) => {
              const id = addTopic({ observationId, title, body, category });
              setCreating(false);
              setOpenId(id);
            }}
          />
        </div>
      )}
    </>
  );
}

function NewTopicForm({ onCreate }) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  return (
    <form
      className="surface space-y-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim() || !body.trim()) return;
        onCreate(title.trim(), body.trim());
      }}
    >
      <input
        className="input"
        placeholder={t('discussion.newTopic')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label={t('discussion.newTopic')}
      />
      <textarea
        rows={3}
        className="input text-sm"
        placeholder={t('discussion.replyPlaceholder')}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <button type="submit" className="btn-primary" disabled={!title.trim() || !body.trim()}>
        {t('discussion.send')}
      </button>
    </form>
  );
}

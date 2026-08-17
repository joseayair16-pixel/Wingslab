'use client';
import { X } from 'lucide-react';

import React, { memo, useEffect, useRef } from 'react';
import { useChatStore } from '../store/chatStore';
import { SaDelLoader } from './SaDelLoader';

interface ChatPanelProps {
  order: any;
  token: string;
  apiBase: string;
  onClose: () => void;
}

export const ChatPanel = memo(function ChatPanel({ order, token, apiBase, onClose }: ChatPanelProps) {
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const chatMessages = useChatStore((s) => s.chatMessages);
  const chatInput = useChatStore((s) => s.chatInput);
  const loadingChat = useChatStore((s) => s.loadingChat);
  const sendingChatMessage = useChatStore((s) => s.sendingChatMessage);
  const setChatInput = useChatStore((s) => s.setChatInput);
  const sendChatMessage = useChatStore((s) => s.sendChatMessage);

  useEffect(() => {
    const loadMessages = useChatStore.getState().loadChatMessages;
    loadMessages(order.id, apiBase, token);
  }, [order.id, apiBase, token]);

  useEffect(() => {
    if (chatMessages.length > 0) {
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [chatMessages]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white/95 backdrop-blur-md h-full flex flex-col shadow-2xl border-l border-neutral-200 animate-slide-left"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-neutral-100 flex items-center justify-between bg-sky-100/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center text-white font-bold shadow-md shadow-sky-200">
              {order.restaurant.name.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <h4 className="font-bold text-neutral-900 leading-tight">{order.restaurant.name}</h4>
              <p className="text-xs text-neutral-500">Soporte y chat de pedido</p>
            </div>
          </div>
          <button
            className="p-2 hover:bg-neutral-100 rounded-full transition-colors"
            onClick={onClose}
          >
            <X className="w-6 h-6 text-neutral-500" />
          </button>
        </div>

        {/* Message Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-neutral-50/50">
          {loadingChat ? (
            <div className="h-full flex items-center justify-center text-neutral-500">
              <SaDelLoader size="sm" label="Cargando chat..." />
            </div>
          ) : chatMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-neutral-400">
              <span className="text-4xl mb-3">💬</span>
              <p className="font-semibold text-neutral-700">¡Inicia la conversación!</p>
              <p className="text-xs mt-1 max-w-xs">Escribe si tienes dudas sobre tu pedido, dirección o algún inconveniente.</p>
            </div>
          ) : (
            chatMessages.map((msg: any) => {
              const isMe = msg.senderRole === 'CUSTOMER';
              return (
                <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} animate-scale-up`}>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm text-sm ${isMe
                    ? 'bg-sky-500 text-white rounded-tr-none'
                    : 'bg-white text-neutral-800 border border-neutral-100 rounded-tl-none'
                    }`}>
                    {!isMe && (
                      <p className="text-[10px] font-bold text-sky-500 mb-0.5 uppercase tracking-wide">
                        {order.restaurant.businessType && order.restaurant.businessType !== 'RESTAURANT' ? 'Tienda' : 'Restaurante'}
                      </p>
                    )}
                    <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    <p className={`text-[9px] text-right mt-1 ${isMe ? 'text-sky-200' : 'text-neutral-400'}`}>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-neutral-100 bg-white">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendChatMessage(apiBase, token);
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Escribe un mensaje al restaurante..."
              className="flex-1 px-4 py-2.5 border border-neutral-200 rounded-full text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all bg-neutral-50"
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || sendingChatMessage}
              className="w-10 h-10 bg-sky-500 text-white rounded-full flex items-center justify-center hover:bg-sky-600 active:scale-95 disabled:bg-neutral-200 disabled:text-neutral-400 transition-all shadow-md shadow-sky-200"
            >
              <svg className="w-5 h-5 transform rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
});

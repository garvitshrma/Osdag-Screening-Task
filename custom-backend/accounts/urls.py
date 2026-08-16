from django.urls import path
from . import views

urlpatterns = [
    path('register', views.register),
    path('login', views.login),
    path('me', views.me),
    path('files', views.files),
    path('files/<int:file_id>', views.file_detail),
    path('logout', views.logout),
    path('files/<int:file_id>/download', views.file_download),
]